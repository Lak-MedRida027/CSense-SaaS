import { createHash } from 'node:crypto';
import { Types, trusted } from 'mongoose';
import type { Logger } from 'pino';
import {
  applyEscalationAction,
  ESCALATION_ADMIN_RESERVE,
  ESCALATION_EVENTS_MAX,
  type DimensionCoverageMap,
  type EscalationActionRequest,
  type EscalationEventType,
  type EscalationReason,
  type EscalationResolution,
  type EscalationReviewTier,
  type EscalationSeverity,
  type EscalationSourceType,
  type EscalationStatus,
  type FeatureFlags,
  RISK_LEVELS,
  decideDisengagement,
  stallAnchorMs,
  type DisengagementReason,
  type RiskLevel,
} from '@csense/shared';
import {
  HttpError,
  conflict,
  notFoundError,
  separationOfDuties,
  validation,
} from '../../lib/httpError.js';
import {
  AuditLog,
  Employee,
  Escalation,
  Module,
  FinalTest,
  QuizAttempt,
  RiskProfile,
  UserProgress,
  User,
  numericSeqFilter,
} from '../../models/index.js';
import { audit, type AuditContext, type AuditRecordInput } from '../audit/audit.service.js';
import type { MarkerService } from '../maintenance/markers.js';
import type { SecurityTeamNotifier } from './notifier.js';

/** A stored escalation as read from the database (lean). */
export interface EscalationEventRow {
  eventId: Types.ObjectId;
  type: EscalationEventType;
  at: Date;
  actorId?: Types.ObjectId | null | undefined;
  actorRole?: 'employee' | 'administrator' | null | undefined;
  fromStatus?: EscalationStatus | null | undefined;
  toStatus?: EscalationStatus | null | undefined;
  note?: string | null | undefined;
  resolution?: EscalationResolution | null | undefined;
  refId?: Types.ObjectId | null | undefined;
  audited: boolean;
  sameAdmin?: boolean | undefined;
}

export interface EscalationRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  reason: EscalationReason;
  severity: EscalationSeverity;
  reviewTier: EscalationReviewTier;
  status: EscalationStatus;
  active: boolean;
  scopeKey?: string | null | undefined;
  dedupeKey: string;
  context: {
    riskLevel?: RiskLevel | null | undefined;
    previousLevel?: RiskLevel | null | undefined;
    compositeScore?: number | null | undefined;
    scores?: Record<string, number | null> | null | undefined;
    coverage?: DimensionCoverageMap | null | undefined;
    riskAssessmentId?: Types.ObjectId | null | undefined;
    modelVersion?: number | null | undefined;
  };
  sourceRef: { type: EscalationSourceType; id: Types.ObjectId };
  openedAt: Date;
  acknowledgedAt?: Date | null | undefined;
  acknowledgedBy?: Types.ObjectId | null | undefined;
  resolvedAt?: Date | null | undefined;
  resolvedBy?: Types.ObjectId | null | undefined;
  assigneeId?: Types.ObjectId | null | undefined;
  resolution?: EscalationResolution | null | undefined;
  managementReference?: string | null | undefined;
  events: EscalationEventRow[];
  version: number;
  retriggerCount?: number | undefined;
  lastRetriggeredAt?: Date | null | undefined;
  lastRetriggerRef?: Types.ObjectId | null | undefined;
}

export interface RiskHighInput {
  userId: string;
  assessmentId: string;
  riskLevel: RiskLevel | null;
  previousLevel: RiskLevel | null;
  compositeScore: number | null;
  scores: Record<string, number | null>;
  coverage: DimensionCoverageMap;
  modelVersion: number;
}

export interface CriticalEventInput {
  userId: string;
  reason: Extract<EscalationReason, 'simulation_credentials_submitted' | 'gate_access_restricted'>;
  sourceRef: { type: EscalationSourceType; id: string };
  occurredAt: Date;
}

export interface EscalationServiceDeps {
  clock: () => Date;
  logger: Logger;
  notifier: SecurityTeamNotifier;
  features: FeatureFlags;
  governance: {
    escalateAfterCooldowns: number;
    cooldownWindowSeconds: number;
    disengagedAfterDays: number;
    requireSecondAdmin: boolean;
  };
  markers: MarkerService;
}

type OpenOutcome = 'opened' | 'retriggered' | 'existing';

interface OpenInput {
  userId: string;
  reason: EscalationReason;
  severity: EscalationSeverity;
  reviewTier: EscalationReviewTier;
  scopeKey: string | null;
  dedupeKey: string;
  context: Partial<EscalationRow['context']> & {
    scores?: Record<string, number | null> | null;
  };
  sourceRef: { type: EscalationSourceType; id: string };
  openedAt: Date;
  /** Event id used when the open escalation is retriggered instead; null disables retriggering. */
  retriggerEventId: string | null;
}

export interface TransitionContext extends AuditContext {
  actorId: string;
}

const isDuplicateKey = (
  err: unknown,
): err is { code: 11000; keyPattern?: Record<string, unknown> } =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

export const COOLDOWN_SCOPE_PREFIX = 'assessment:';

/** System events (opened, retriggered) stop here; the rest of the cap belongs to administrators. */
export const SYSTEM_EVENTS_MAX = ESCALATION_EVENTS_MAX - ESCALATION_ADMIN_RESERVE;

export interface EscalationService {
  openForRiskHigh(input: RiskHighInput): Promise<{ escalationId: string; outcome: OpenOutcome }>;
  recordCriticalEvent(input: CriticalEventInput): Promise<{ escalationId: string }>;
  /** Open (or retrigger) an escalation for assessments with repeated cooldowns in the window. */
  evaluateCooldowns(userId: string): Promise<string[]>;
  /**
   * Flag one active employee who is still "not assessed" DISENGAGED_AFTER_DAYS after their account
   * was created. At most one such escalation per employee, ever; returns its id or null.
   */
  evaluateDisengagement(userId: string): Promise<string | null>;
  /** One bounded page of the periodic scan (indexed queries only). `next` is null at the end. */
  scanDisengaged(page: { afterId: string | null; pageSize: number }): Promise<{
    opened: number;
    next: string | null;
  }>;
  transition(
    escalationId: string,
    request: EscalationActionRequest,
    ctx: TransitionContext,
  ): Promise<EscalationRow>;
  /** Write the audit entry of every event not yet audited (the outbox). Returns how many were written. */
  flushAudit(
    escalationId: string,
    inline?: { eventId: string; ctx: AuditContext },
  ): Promise<number>;
  /** Escalations that still have unaudited events (optionally older than `olderThan`). */
  pendingAudit(olderThan?: Date): Promise<string[]>;
}

export function createEscalationService(deps: EscalationServiceDeps): EscalationService {
  const { clock, logger } = deps;

  const notice = (
    e: Pick<EscalationRow, 'reason' | 'severity' | 'reviewTier'> & { id: string },
  ) => ({
    escalationId: e.id,
    reason: e.reason,
    severity: e.severity,
    reviewTier: e.reviewTier,
  });

  function auditInputFor(
    esc: EscalationRow,
    event: EscalationEventRow,
    ctx: AuditContext | undefined,
  ): AuditRecordInput {
    const id = esc._id.toHexString();
    const eventId = event.eventId.toHexString();
    const base = {
      outcome: 'success' as const,
      target: { type: 'escalation' as const, id: esc._id },
      idempotencyKey: `escalation:${id}:event:${eventId}`,
      ...(ctx ? { ctx } : {}),
      ...(event.actorId && event.actorRole
        ? { actor: { id: event.actorId, role: event.actorRole } }
        : {}),
    };
    const note = event.note ?? null;
    const noteMeta = note === null ? {} : { noteSha256: sha256(note), noteLength: note.length };
    const subject = esc.userId.toHexString();
    const assessmentId = esc.scopeKey?.startsWith(COOLDOWN_SCOPE_PREFIX)
      ? esc.scopeKey.slice(COOLDOWN_SCOPE_PREFIX.length)
      : undefined;
    switch (event.type) {
      case 'opened':
        return {
          ...base,
          action: 'escalation.opened',
          severity: esc.severity === 'critical' ? 'critical' : 'warning',
          metadata: {
            subjectUserId: subject,
            reason: esc.reason,
            reviewTier: esc.reviewTier,
            riskLevel: esc.context.riskLevel ?? null,
            previousLevel: esc.context.previousLevel ?? null,
            compositeScore: esc.context.compositeScore ?? null,
            riskAssessmentId: esc.context.riskAssessmentId?.toHexString() ?? null,
            modelVersion: esc.context.modelVersion ?? null,
            ...(assessmentId ? { assessmentId } : {}),
          },
        };
      case 'retriggered':
        return {
          ...base,
          action: 'escalation.retriggered',
          severity: 'warning',
          metadata: {
            subjectUserId: subject,
            riskAssessmentId: esc.context.riskAssessmentId?.toHexString() ?? null,
            compositeScore: esc.context.compositeScore ?? null,
            sourceId: event.refId?.toHexString() ?? null,
          },
        };
      case 'acknowledged':
        return {
          ...base,
          action: 'escalation.acknowledged',
          severity: 'info',
          metadata: {
            eventId,
            from: event.fromStatus ?? null,
            to: event.toStatus ?? null,
            ...noteMeta,
          },
        };
      case 'note':
        return {
          ...base,
          action: 'escalation.note_added',
          severity: 'info',
          metadata: { eventId, ...noteMeta },
        };
      case 'resolved':
        return {
          ...base,
          action: 'escalation.resolved',
          severity:
            event.resolution === 'risk_accepted' || event.sameAdmin === true ? 'warning' : 'info',
          metadata: {
            eventId,
            ...(event.sameAdmin === true ? { sameAdmin: true } : {}),
            from: event.fromStatus ?? null,
            to: event.toStatus ?? null,
            resolution: event.resolution ?? null,
            ...(esc.managementReference ? { managementReference: esc.managementReference } : {}),
            ...noteMeta,
          },
        };
    }
  }

  const service: EscalationService = {
    async flushAudit(escalationId, inline) {
      const esc = await Escalation.findById(escalationId).lean<EscalationRow>();
      if (!esc) return 0;
      let written = 0;
      for (const event of esc.events) {
        if (event.audited) continue;
        const ctx =
          inline && inline.eventId === event.eventId.toHexString() ? inline.ctx : undefined;
        const result = await audit.record(auditInputFor(esc, event, ctx));
        if (!result.duplicate) written += 1;
        await Escalation.updateOne(
          { _id: esc._id, 'events.eventId': event.eventId },
          { $set: { 'events.$.audited': true } },
        );
      }
      return written;
    },

    async pendingAudit(olderThan) {
      const rows = await Escalation.find({
        events: trusted({
          $elemMatch: { audited: false, ...(olderThan ? { at: { $lt: olderThan } } : {}) },
        }),
      })
        .select('_id')
        .limit(200)
        .lean();
      return rows.map((r) => r._id.toHexString());
    },

    async openForRiskHigh(input) {
      const { escalationId, outcome } = await openOrRetrigger({
        userId: input.userId,
        reason: 'risk_level_high',
        severity: 'elevated',
        reviewTier: 'security_team',
        scopeKey: 'risk',
        dedupeKey: `risk_level_high:${input.userId}:${input.assessmentId}`,
        context: {
          riskLevel: input.riskLevel,
          previousLevel: input.previousLevel,
          compositeScore: input.compositeScore,
          scores: input.scores,
          coverage: input.coverage,
          riskAssessmentId: new Types.ObjectId(input.assessmentId),
          modelVersion: input.modelVersion,
        },
        sourceRef: { type: 'risk_assessment', id: input.assessmentId },
        openedAt: clock(),
        retriggerEventId: input.assessmentId,
      });
      return { escalationId, outcome };
    },

    async recordCriticalEvent(input) {
      if (input.reason === 'simulation_credentials_submitted' && !deps.features.phishing) {
        throw new Error('simulation_credentials_submitted needs FEATURE_PHISHING to be enabled');
      }
      const subject = input.userId;
      await audit.record({
        action: 'governance.critical_event_recorded',
        outcome: 'success',
        severity: 'critical',
        target: { type: 'user', id: subject },
        idempotencyKey: `critical:${input.reason}:${input.sourceRef.id}`,
        metadata: {
          reason: input.reason,
          sourceType: input.sourceRef.type,
          sourceId: input.sourceRef.id,
          occurredAt: input.occurredAt,
        },
      });
      const { escalationId } = await openOrRetrigger({
        userId: subject,
        reason: input.reason,
        severity: 'critical',
        reviewTier: 'management',
        scopeKey: null,
        dedupeKey: `${input.reason}:${input.sourceRef.type}:${input.sourceRef.id}`,
        context: {},
        sourceRef: input.sourceRef,
        openedAt: clock(),
        retriggerEventId: null,
      });
      return { escalationId };
    },

    async evaluateCooldowns(userId) {
      const threshold = deps.governance.escalateAfterCooldowns;
      const since = new Date(clock().getTime() - deps.governance.cooldownWindowSeconds * 1000);
      const entries = await AuditLog.find({
        action: 'learning.assessment.cooldown',
        targetId: new Types.ObjectId(userId),
        seq: numericSeqFilter(),
        createdAt: trusted({ $gte: since }),
      })
        .select('metadata.assessmentId createdAt seq')
        // Newest first, so the cap drops the oldest entries in the window and "latest" is right.
        .sort({ createdAt: -1, _id: -1 })
        .limit(500)
        .lean<{ _id: Types.ObjectId; metadata?: { assessmentId?: unknown } }[]>();
      entries.reverse();

      const byAssessment = new Map<string, Types.ObjectId[]>();
      for (const entry of entries) {
        const assessmentId = entry.metadata?.assessmentId;
        if (typeof assessmentId !== 'string' || !/^[0-9a-f]{24}$/i.test(assessmentId)) continue;
        const list = byAssessment.get(assessmentId);
        if (list) list.push(entry._id);
        else byAssessment.set(assessmentId, [entry._id]);
      }

      const opened: string[] = [];
      for (const [assessmentId, ids] of byAssessment) {
        const latest = ids.at(-1);
        if (ids.length < threshold || !latest) continue;
        const { escalationId } = await openOrRetrigger({
          userId,
          reason: 'repeated_assessment_cooldowns',
          severity: 'elevated',
          reviewTier: 'security_team',
          scopeKey: `${COOLDOWN_SCOPE_PREFIX}${assessmentId}`,
          dedupeKey: `repeated_assessment_cooldowns:${userId}:${assessmentId}:${latest.toHexString()}`,
          context: {},
          sourceRef: { type: 'audit_entry', id: latest.toHexString() },
          openedAt: clock(),
          retriggerEventId: latest.toHexString(),
        });
        opened.push(escalationId);
      }
      return opened;
    },

    async evaluateDisengagement(userId) {
      const owner = new Types.ObjectId(userId);
      const employee = await Employee.findOne({
        _id: owner,
        isActive: true,
        createdAt: trusted({ $lte: disengagedCutoff() }),
      })
        .select('_id createdAt')
        .lean();
      if (!employee) return null;
      return (await flagDisengaged([employee])).get(userId) ?? null;
    },

    async scanDisengaged({ afterId, pageSize }) {
      if (!(await hasCurriculum())) return { opened: 0, next: null };
      const users = await Employee.find({
        isActive: true,
        createdAt: trusted({ $lte: disengagedCutoff() }),
        ...(afterId ? { _id: trusted({ $gt: new Types.ObjectId(afterId) }) } : {}),
      })
        .sort({ _id: 1 })
        .limit(pageSize)
        .select('_id createdAt')
        .lean();
      const last = users.at(-1);
      const opened = users.length === 0 ? 0 : (await flagDisengaged(users)).size;
      return { opened, next: users.length === pageSize && last ? last._id.toHexString() : null };
    },

    async transition(escalationId, request, ctx) {
      for (let tries = 1; ; tries += 1) {
        const result = await attemptTransition(escalationId, request, ctx, tries < 5);
        if (result !== 'retry') return result;
      }
    },
  };

  /** A refused resolve leaves state alone and is audited as a warning (never with note text). */
  async function refuseResolve(
    esc: EscalationRow,
    request: EscalationActionRequest,
    ctx: TransitionContext,
    reason: 'same_admin' | 'not_acknowledged' | 'created_by_acknowledger',
  ): Promise<void> {
    try {
      await audit.record({
        action: 'escalation.resolve_refused',
        outcome: 'failure',
        severity: 'warning',
        actor: { id: ctx.actorId, role: 'administrator' },
        target: { type: 'escalation', id: esc._id },
        ctx: { ip: ctx.ip, userAgent: ctx.userAgent, requestId: ctx.requestId },
        metadata: {
          reason,
          escalationSeverity: esc.severity,
          reviewTier: esc.reviewTier,
          resolution: request.action === 'resolve' ? request.resolution : null,
          status: esc.status,
        },
      });
    } catch (err) {
      // The refusal stands whether or not it could be written down.
      logger.error({ err, escalationId: esc._id.toHexString() }, 'Refused-resolve audit failed');
    }
  }

  /** One load, check and conditional write. Notes without expectedVersion retry on a version race. */
  async function attemptTransition(
    escalationId: string,
    request: EscalationActionRequest,
    ctx: TransitionContext,
    mayRetry: boolean,
  ): Promise<EscalationRow | 'retry'> {
    {
      const current = await Escalation.findById(escalationId).lean<EscalationRow>();
      if (!current) throw notFoundError();

      // Separation of duties (P4-L8, P4-L11): a critical or management-tier escalation, and any
      // resolution other than remediated, must be resolved by a different administrator than the
      // one who acknowledged it, and not by an account that administrator created.
      const needsSecondAdmin =
        request.action === 'resolve' &&
        (current.severity === 'critical' ||
          current.reviewTier === 'management' ||
          request.resolution !== 'remediated');
      const enforceSecondAdmin = needsSecondAdmin && deps.governance.requireSecondAdmin;
      const acknowledger = current.acknowledgedBy?.toHexString() ?? null;
      let createdByAcknowledger = false;
      if (needsSecondAdmin && acknowledger !== null && acknowledger !== ctx.actorId) {
        const resolver = await User.findById(ctx.actorId).select('createdBy').lean();
        createdByAcknowledger = resolver?.createdBy?.toHexString() === acknowledger;
      }
      // (Only while the escalation is still open to resolve; a resolved one is a plain state error.)
      if (
        enforceSecondAdmin &&
        current.status !== 'resolved' &&
        (current.status === 'open' || acknowledger === ctx.actorId || createdByAcknowledger)
      ) {
        await refuseResolve(
          current,
          request,
          ctx,
          current.status === 'open'
            ? 'not_acknowledged'
            : acknowledger === ctx.actorId
              ? 'same_admin'
              : 'created_by_acknowledger',
        );
        throw separationOfDuties();
      }
      const sameAdmin =
        needsSecondAdmin &&
        !enforceSecondAdmin &&
        (acknowledger === ctx.actorId || createdByAcknowledger);

      const decision = applyEscalationAction(current.status, request.action);
      if (!decision.ok) {
        throw new HttpError(
          409,
          'INVALID_STATE_TRANSITION',
          `Cannot ${request.action} an escalation that is ${current.status}`,
        );
      }
      if (
        request.action === 'resolve' &&
        current.reviewTier === 'management' &&
        !request.managementReference
      ) {
        throw validation([
          {
            location: 'body',
            path: 'managementReference',
            message: 'is required to resolve an escalation that needs management review',
          },
        ]);
      }
      const expected = request.expectedVersion;
      if (expected !== undefined && expected !== current.version) {
        throw conflict('The escalation changed since you loaded it; reload and try again');
      }
      if (current.events.length >= ESCALATION_EVENTS_MAX) {
        throw conflict('This escalation has reached its maximum number of events');
      }

      const now = clock();
      const actorId = new Types.ObjectId(ctx.actorId);
      const eventId = new Types.ObjectId();
      const type: EscalationEventType =
        request.action === 'acknowledge'
          ? 'acknowledged'
          : request.action === 'resolve'
            ? 'resolved'
            : 'note';
      const event = {
        eventId,
        type,
        at: now,
        actorId,
        actorRole: 'administrator' as const,
        fromStatus: current.status,
        toStatus: decision.next,
        note: request.note ?? null,
        resolution: request.action === 'resolve' ? request.resolution : null,
        refId: null,
        audited: false,
        sameAdmin,
      };
      const set: Record<string, unknown> = {};
      if (request.action === 'acknowledge') {
        Object.assign(set, {
          status: 'acknowledged',
          acknowledgedAt: now,
          acknowledgedBy: actorId,
          assigneeId: actorId,
        });
      } else if (request.action === 'resolve') {
        Object.assign(set, {
          status: 'resolved',
          active: false,
          resolvedAt: now,
          resolvedBy: actorId,
          resolution: request.resolution,
          ...(request.managementReference
            ? { managementReference: request.managementReference }
            : {}),
        });
      }

      const updated = await Escalation.findOneAndUpdate(
        {
          _id: current._id,
          status: current.status,
          version: current.version,
          // Enforced in the same conditional write: the acknowledger is never this administrator.
          ...(enforceSecondAdmin ? { acknowledgedBy: trusted({ $nin: [actorId, null] }) } : {}),
          // Room for one more event, checked by the database as well.
          [`events.${String(ESCALATION_EVENTS_MAX - 1)}`]: trusted({ $exists: false }),
        },
        {
          ...(Object.keys(set).length > 0 ? { $set: set } : {}),
          $push: { events: event },
          $inc: { version: 1 },
        },
        { returnDocument: 'after' },
      ).lean<EscalationRow>();

      if (!updated) {
        const reloaded = await Escalation.findById(escalationId)
          .select('status version acknowledgedBy')
          .lean();
        if (!reloaded) throw notFoundError();
        if (
          enforceSecondAdmin &&
          (reloaded.acknowledgedBy == null || reloaded.acknowledgedBy.toHexString() === ctx.actorId)
        ) {
          await refuseResolve(current, request, ctx, 'same_admin');
          throw separationOfDuties();
        }
        // A note is valid in every status, so a status change under it is only a reason to retry.
        if (request.action !== 'note' && reloaded.status !== current.status) {
          throw new HttpError(
            409,
            'INVALID_STATE_TRANSITION',
            `Cannot ${request.action} an escalation that is ${reloaded.status}`,
          );
        }
        if (request.expectedVersion === undefined && mayRetry) return 'retry';
        throw conflict('The escalation changed since you loaded it; reload and try again');
      }

      try {
        await service.flushAudit(escalationId, {
          eventId: eventId.toHexString(),
          ctx: { ip: ctx.ip, userAgent: ctx.userAgent, requestId: ctx.requestId },
        });
      } catch (err) {
        // The state change stands and its event is flagged unaudited; the sweeper completes the
        // audit (ADR 0011). The caller is told the truth: the request did not fully succeed.
        logger.error({ err, escalationId }, 'Escalation audit write failed; left for the sweeper');
        await deps.markers.mark(current.userId.toHexString(), 'audit');
        throw new HttpError(500, 'INTERNAL_ERROR', 'Internal server error');
      }
      return (await Escalation.findById(escalationId).lean<EscalationRow>()) ?? updated;
    }
  }

  const disengagedCutoff = (): Date =>
    new Date(clock().getTime() - deps.governance.disengagedAfterDays * 86_400_000);

  const DISENGAGED_REASONS: DisengagementReason[] = [
    'disengaged_unassessed',
    'disengaged_no_progress',
  ];

  const hasCurriculum = async (): Promise<boolean> =>
    (await Module.exists({ isPublished: true })) !== null || (await FinalTest.exists({})) !== null;

  /**
   * Flag the employees (of one page) who stalled: unfinished curriculum and no progress for
   * DISENGAGED_AFTER_DAYS, where progress is the latest of account creation, module start,
   * exercise answer, content completion, attempt, and the resolution of an earlier flag. The reason
   * says whether they were ever assessed. A fixed number of batched, indexed reads per page; no
   * recompute per employee. Returns the escalation id per flagged employee.
   */
  async function flagDisengaged(
    people: readonly { _id: Types.ObjectId; createdAt: Date }[],
  ): Promise<Map<string, string>> {
    const flagged = new Map<string, string>();
    if (people.length === 0) return flagged;
    const ids = people.map((p) => p._id);
    const [modules, finalTest] = await Promise.all([
      Module.find({ isPublished: true }).select('_id').lean(),
      FinalTest.exists({}),
    ]);
    if (modules.length === 0 && finalTest === null) return flagged;
    const moduleIds = modules.map((m) => m._id.toHexString());

    const [attemptLast, progressLast, passes, resolvedLast, assessed, active] = await Promise.all([
      QuizAttempt.aggregate<{ _id: Types.ObjectId; last: Date }>([
        { $match: { userId: { $in: ids } } },
        { $group: { _id: '$userId', last: { $max: '$attemptedAt' } } },
      ]),
      UserProgress.aggregate<{ _id: Types.ObjectId; last: Date | null }>([
        { $match: { userId: { $in: ids } } },
        {
          $project: {
            userId: 1,
            t: {
              $max: [
                '$startedAt',
                '$lastAttemptAt',
                '$contentCompletedAt',
                { $max: '$exerciseAnswers.answeredAt' },
              ],
            },
          },
        },
        { $group: { _id: '$userId', last: { $max: '$t' } } },
      ]),
      QuizAttempt.find({ userId: trusted({ $in: ids }), passed: true })
        .select('userId type moduleId')
        .lean(),
      Escalation.aggregate<{ _id: Types.ObjectId; last: Date | null }>([
        {
          $match: {
            userId: { $in: ids },
            reason: { $in: DISENGAGED_REASONS },
            status: 'resolved',
          },
        },
        { $group: { _id: '$userId', last: { $max: '$resolvedAt' } } },
      ]),
      RiskProfile.find({
        userId: trusted({ $in: ids }),
        riskLevel: trusted({ $in: [...RISK_LEVELS] }),
      })
        .select('userId')
        .lean(),
      Escalation.find({
        userId: trusted({ $in: ids }),
        reason: trusted({ $in: DISENGAGED_REASONS }),
        active: true,
      })
        .select('userId')
        .lean(),
    ]);

    const lastByUser = (rows: { _id: Types.ObjectId; last: Date | null }[]) =>
      new Map(rows.map((r) => [r._id.toHexString(), r.last?.getTime() ?? null]));
    const attempts = lastByUser(attemptLast);
    const progress = lastByUser(progressLast);
    const resolved = lastByUser(resolvedLast);
    const assessedSet = new Set(assessed.map((r) => r.userId.toHexString()));
    const activeSet = new Set(active.map((r) => r.userId.toHexString()));
    const passedModules = new Map<string, Set<string>>();
    const finalPassed = new Set<string>();
    for (const p of passes) {
      const user = p.userId.toHexString();
      if (p.type === 'FinalTest') finalPassed.add(user);
      else if (p.moduleId) {
        const set = passedModules.get(user) ?? new Set<string>();
        set.add(p.moduleId.toHexString());
        passedModules.set(user, set);
      }
    }

    for (const person of people) {
      const user = person._id.toHexString();
      const passed = passedModules.get(user);
      const anchorMs = stallAnchorMs([
        person.createdAt.getTime(),
        attempts.get(user),
        progress.get(user),
        resolved.get(user),
      ]);
      const reason = decideDisengagement({
        nowMs: clock().getTime(),
        afterDays: deps.governance.disengagedAfterDays,
        anchorMs,
        assessed: assessedSet.has(user),
        hasCurriculum: true,
        finished:
          moduleIds.every((m) => passed?.has(m) === true) &&
          (finalTest === null || finalPassed.has(user)),
        alreadyActive: activeSet.has(user),
      });
      if (reason === null) continue;
      try {
        const opened = await openOrRetrigger({
          userId: user,
          reason,
          severity: 'elevated',
          reviewTier: 'security_team',
          // One scope for both reasons: the database allows one active flag per employee.
          scopeKey: 'disengaged',
          // One flag per stall: a new one needs progress (or a resolution) and another full period.
          dedupeKey: `${reason}:${user}:${String(anchorMs)}`,
          context: {},
          sourceRef: { type: 'employee_account', id: user },
          openedAt: clock(),
          retriggerEventId: null,
        });
        if (opened.outcome === 'opened') flagged.set(user, opened.escalationId);
      } catch (err) {
        logger.error(
          { err, userId: user },
          'Disengagement escalation failed; the next scan retries',
        );
      }
    }
    return flagged;
  }

  async function openOrRetrigger(
    n: OpenInput,
  ): Promise<{ escalationId: string; outcome: OpenOutcome }> {
    const userId = new Types.ObjectId(n.userId);
    const eventId = new Types.ObjectId();
    let escalationId: string;
    let outcome: OpenOutcome = 'opened';
    try {
      const doc = await Escalation.create({
        userId,
        reason: n.reason,
        severity: n.severity,
        reviewTier: n.reviewTier,
        status: 'open',
        active: true,
        scopeKey: n.scopeKey,
        dedupeKey: n.dedupeKey,
        context: {
          riskLevel: n.context.riskLevel ?? null,
          previousLevel: n.context.previousLevel ?? null,
          compositeScore: n.context.compositeScore ?? null,
          scores: n.context.scores ?? null,
          coverage: n.context.coverage ?? null,
          riskAssessmentId: n.context.riskAssessmentId ?? null,
          modelVersion: n.context.modelVersion ?? null,
        },
        sourceRef: { type: n.sourceRef.type, id: new Types.ObjectId(n.sourceRef.id) },
        openedAt: n.openedAt,
        events: [{ eventId, type: 'opened', at: n.openedAt, toStatus: 'open', audited: false }],
        version: 0,
      });
      escalationId = doc.id;
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      const pattern = err.keyPattern ?? {};
      if ('dedupeKey' in pattern) {
        const existing = await Escalation.findOne({ dedupeKey: n.dedupeKey }).select('_id').lean();
        if (!existing) throw err;
        escalationId = existing._id.toHexString();
        outcome = 'existing';
      } else if (n.scopeKey !== null && n.retriggerEventId !== null) {
        const retrigger = new Types.ObjectId(n.retriggerEventId);
        const active = await Escalation.findOne({
          userId,
          reason: n.reason,
          scopeKey: n.scopeKey,
          active: true,
        })
          .select('_id')
          .lean();
        if (!active) throw err;
        escalationId = active._id.toHexString();
        const at = clock();
        // System events (opened, retriggered) may only use the budget below the admin reserve, so
        // an employee who keeps earning cooldowns can never take the room reviewers need.
        const pushed = await Escalation.updateOne(
          {
            _id: active._id,
            'events.eventId': trusted({ $ne: retrigger }),
            [`events.${String(SYSTEM_EVENTS_MAX - 1)}`]: trusted({ $exists: false }),
          },
          {
            $push: {
              events: {
                eventId: retrigger,
                type: 'retriggered',
                at,
                refId: retrigger,
                audited: false,
              },
            },
            $inc: { version: 1 },
          },
        );
        if (pushed.modifiedCount === 1) {
          outcome = 'retriggered';
        } else {
          // Budget spent: fold the retrigger into counters, once per source (lastRetriggerRef).
          const counted = await Escalation.updateOne(
            {
              _id: active._id,
              lastRetriggerRef: trusted({ $ne: retrigger }),
              'events.eventId': trusted({ $ne: retrigger }),
              [`events.${String(SYSTEM_EVENTS_MAX - 1)}`]: trusted({ $exists: true }),
            },
            {
              $inc: { retriggerCount: 1 },
              $set: { lastRetriggeredAt: at, lastRetriggerRef: retrigger },
            },
          );
          outcome = counted.modifiedCount === 1 ? 'retriggered' : 'existing';
        }
      } else {
        throw err;
      }
    }

    if (outcome !== 'existing') {
      const row = await Escalation.findById(escalationId)
        .select('reason severity reviewTier')
        .lean<Pick<EscalationRow, 'reason' | 'severity' | 'reviewTier'>>();
      if (row) {
        const n2 = notice({ ...row, id: escalationId });
        if (outcome === 'opened') await deps.notifier.escalationOpened(n2);
        else await deps.notifier.escalationRetriggered(n2);
      }
    }
    await service.flushAudit(escalationId);
    return { escalationId, outcome };
  }

  return service;
}
