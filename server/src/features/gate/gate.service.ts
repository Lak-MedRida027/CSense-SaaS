import { createHash } from 'node:crypto';
import { Types, trusted } from 'mongoose';
import type { Logger } from 'pino';
import {
  GATE_OFFLINE_FUTURE_SKEW_SECONDS,
  GATE_OFFLINE_MAX_AGE_DAYS,
  GATE_SELECTION_HISTORY,
  selectQuestionIds,
  type GateAttemptRequest,
  type GateAttemptResultDTO,
  type GateOfflineReleaseRequest,
  type GateOfflineReleaseResultDTO,
  type GateStatusDTO,
} from '@csense/shared';
import type { AppConfig } from '../../config/appConfig.js';
import { gateChallengeStale, gateUnavailable, validation } from '../../lib/httpError.js';
import { GateAnswer, GateQuestion, GateRun } from '../../models/index.js';
import { audit } from '../audit/audit.service.js';
import type { XpService } from '../gamification/xp.service.js';
import type { EscalationService } from '../governance/escalation.service.js';
import type { Shuffle } from '../learning/shuffle.js';
import type { MarkerService } from '../maintenance/markers.js';
import type { RiskService } from '../risk/risk.service.js';
import {
  challengeStatus,
  grantedStatus,
  requiredStatus,
  restrictedStatus,
  type GateQuestionView,
  type GateRunRow,
} from './gate.mapper.js';
import { applyRestrictionEffects } from './gate.restriction.js';

export interface GateServiceDeps {
  clock: () => Date;
  logger: Logger;
  shuffle: Shuffle;
  gate: AppConfig['gate'];
  escalations: Pick<EscalationService, 'recordCriticalEvent' | 'recordRetrigger'>;
  xp: Pick<XpService, 'recomputeXp'>;
  risk: Pick<RiskService, 'recomputeForUser'>;
  markers: MarkerService;
}

export interface GateService {
  /** Pure read: never creates a run or a challenge. */
  getStatus(userId: string): Promise<GateStatusDTO>;
  /** Get or create the open run's current challenge. Idempotent until the challenge is answered. */
  openChallenge(userId: string): Promise<GateStatusDTO>;
  submitAttempt(userId: string, request: GateAttemptRequest): Promise<GateAttemptResultDTO>;
  /** Record that the desktop released the workstation offline (D5-12, P5-M1). */
  reportOfflineRelease(
    userId: string,
    request: GateOfflineReleaseRequest,
    ctx: {
      ip?: string | undefined;
      userAgent?: string | undefined;
      requestId?: string | undefined;
    },
  ): Promise<{ result: GateOfflineReleaseResultDTO; created: boolean }>;
}

interface DrawnQuestion extends GateQuestionView {
  id: Types.ObjectId;
  correctAnswer: number;
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const FALLBACK_EXPLANATION = 'Review the security awareness guidance from your security team.';
const isDuplicateKey = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;

export function createGateService(deps: GateServiceDeps): GateService {
  const { clock, logger } = deps;
  const tz = deps.gate.orgTimeZone;

  /** One warning audit entry per hour, however many employees hit the missing content. */
  async function noteUnavailable(active: number, required: number): Promise<void> {
    logger.error({ event: 'gate.content_unavailable', active, required }, 'Gate pool too small');
    try {
      const hour = Math.floor(clock().getTime() / 3_600_000);
      await audit.record({
        action: 'gate.content_unavailable',
        outcome: 'failure',
        severity: 'warning',
        idempotencyKey: `gate:content_unavailable:${String(hour)}`,
        metadata: { activeQuestions: active, required },
      });
    } catch (err) {
      logger.error({ err }, 'Gate content-unavailable audit failed');
    }
  }

  /**
   * Pick the next question: active, not yet served in this run, preferring what the employee has
   * not seen among their last GATE_SELECTION_HISTORY answers. Needs at least `maxAttempts` active
   * questions, otherwise the gate is unavailable (503).
   */
  async function drawQuestion(
    userId: Types.ObjectId,
    servedInRun: readonly Types.ObjectId[],
    maxAttempts: number,
  ): Promise<DrawnQuestion> {
    const active = await GateQuestion.find({ isActive: true }).select('_id').limit(1000).lean();
    if (active.length < maxAttempts) {
      await noteUnavailable(active.length, maxAttempts);
      throw gateUnavailable();
    }
    const exclude = new Set(servedInRun.map((i) => i.toHexString()));
    const pool = active.map((q) => q._id.toHexString()).filter((id) => !exclude.has(id));
    if (pool.length === 0) {
      await noteUnavailable(active.length, maxAttempts);
      throw gateUnavailable();
    }
    const recent = await GateAnswer.find({ userId })
      .select('questionId')
      .sort({ answeredAt: -1, _id: -1 })
      .limit(GATE_SELECTION_HISTORY)
      .lean();
    // selectQuestionIds wants the oldest entry first.
    const history = [...recent].reverse().map((a) => [a.questionId.toHexString()]);
    const [picked] = selectQuestionIds(pool, history, 1, deps.shuffle);
    const question = picked
      ? await GateQuestion.findById(picked).select('prompt options +correctAnswer').lean<{
          _id: Types.ObjectId;
          prompt: string;
          options: string[];
          correctAnswer: number;
        }>()
      : null;
    if (!question) throw gateUnavailable();
    // Options are shuffled per challenge, so the position of the right answer carries no signal and
    // the stored key refers to the order that was actually served.
    const order = deps.shuffle(question.options.map((_, i) => i));
    return {
      id: question._id,
      prompt: question.prompt,
      options: order.map((i) => question.options[i] ?? ''),
      correctAnswer: order.indexOf(question.correctAnswer),
    };
  }

  /** The `current` challenge subdocument for a drawn question (the key stays server-side). */
  const currentFor = (question: DrawnQuestion, challengeId: Types.ObjectId, servedAt: Date) => ({
    challengeId,
    questionId: question.id,
    prompt: question.prompt,
    options: question.options,
    optionCount: question.options.length,
    correctAnswer: question.correctAnswer,
    servedAt,
  });

  async function findOpenRun(owner: Types.ObjectId): Promise<GateRunRow | null> {
    return GateRun.findOne({ userId: owner, status: 'open' }).lean<GateRunRow>();
  }

  /** A challenge older than GATE_CHALLENGE_TTL is stale (P5-I4). */
  const expired = (servedAt: Date, now: Date): boolean =>
    now.getTime() - servedAt.getTime() > deps.gate.challengeTtlSeconds * 1000;

  async function statusOf(owner: Types.ObjectId): Promise<GateStatusDTO> {
    const now = clock();
    // The run is the record of truth; the user flag is only the access gate's cache of it.
    const restricted = await GateRun.findOne({
      userId: owner,
      status: 'restricted',
      restoredAt: null,
    })
      .sort({ closedAt: -1, _id: -1 })
      .lean<GateRunRow>();
    if (restricted) return restrictedStatus(restricted, tz);

    const [cleared, open] = await Promise.all([
      GateRun.findOne({ userId: owner, status: 'passed', clearedUntil: trusted({ $gt: now }) })
        .sort({ clearedUntil: -1 })
        .lean<GateRunRow>(),
      findOpenRun(owner),
    ]);
    if (cleared?.clearedUntil) return grantedStatus(cleared, cleared.clearedUntil);
    if (open?.current && !expired(open.current.servedAt, now)) {
      return challengeStatus(open, open.current.challengeId, open.current);
    }
    if (open) {
      // An open run with no live challenge (expired, or none could be drawn): the client asks for one.
      return {
        ...requiredStatus(open.maxAttempts),
        attemptsRemaining: Math.max(0, open.maxAttempts - open.attemptsUsed),
      };
    }
    return requiredStatus(deps.gate.maxAttempts);
  }

  /** The effects of a pass. Failures never fail the response (ADR 0008): a marker repairs them. */
  async function passEffects(userId: string, runId: string): Promise<number> {
    let xpEarned = 0;
    let failed = false;
    try {
      xpEarned = (await deps.xp.recomputeXp(userId, { attemptId: runId })).xpEarned;
    } catch (err) {
      failed = true;
      logger.error({ err, userId, runId }, 'Gate XP failed; left for reconciliation');
    }
    try {
      await deps.risk.recomputeForUser(userId, { type: 'gate_run', refId: runId });
    } catch (err) {
      failed = true;
      logger.error({ err, userId, runId }, 'Gate risk recompute failed; left for reconciliation');
    }
    if (failed) await deps.markers.mark(userId, 'gate');
    return xpEarned;
  }

  async function restrictionEffects(userId: string, run: GateRunRow): Promise<void> {
    try {
      await applyRestrictionEffects(
        { escalations: deps.escalations, risk: deps.risk },
        { userId, runId: run._id.toHexString(), restrictedAt: run.closedAt ?? clock() },
      );
    } catch (err) {
      // The run says restricted and the response will too; reconcile completes the rest.
      logger.error(
        { err, userId, runId: run._id.toHexString() },
        'Gate restriction effects incomplete; left for reconciliation',
      );
      await deps.markers.mark(userId, 'gate');
    }
  }

  return {
    getStatus: (userId) => statusOf(new Types.ObjectId(userId)),

    async openChallenge(userId) {
      const owner = new Types.ObjectId(userId);
      const current = await statusOf(owner);
      if (current.state === 'granted' || current.state === 'restricted') return current;
      if (current.state === 'challenge') return current;

      const now = clock();
      const open = await findOpenRun(owner);
      if (open) {
        // Decide from the run as read now, never from the status read above: a concurrent call may
        // have created this run (with a live challenge) in between. Replacing a live challenge would
        // let parallel requests reveal extra questions without consuming an attempt.
        if (open.current && !expired(open.current.servedAt, now)) return statusOf(owner);
        // No live challenge on the open run (expired, or the pool was empty when the last answer
        // was graded): serve a new one. The attempt count is untouched. Questions already answered
        // in this run are excluded; the expired one may be served again.
        const answeredIds = open.servedQuestionIds.filter(
          (id) => !open.current || !id.equals(open.current.questionId),
        );
        const question = await drawQuestion(owner, answeredIds, open.maxAttempts);
        await GateRun.updateOne(
          {
            _id: open._id,
            status: 'open',
            attemptsUsed: open.attemptsUsed,
            version: open.version,
          },
          {
            $set: { current: currentFor(question, new Types.ObjectId(), now) },
            $addToSet: { servedQuestionIds: question.id },
            $inc: { version: 1 },
          },
        );
        return statusOf(owner);
      }
      const question = await drawQuestion(owner, [], deps.gate.maxAttempts);
      try {
        await GateRun.create({
          userId: owner,
          status: 'open',
          maxAttempts: deps.gate.maxAttempts,
          attemptsUsed: 0,
          current: currentFor(question, new Types.ObjectId(), now),
          servedQuestionIds: [question.id],
          openedAt: now,
        });
      } catch (err) {
        // A concurrent call created the one open run (partial unique index): use theirs.
        if (!isDuplicateKey(err)) throw err;
      }
      return statusOf(owner);
    },

    async submitAttempt(userId, request) {
      const owner = new Types.ObjectId(userId);
      const run = await GateRun.findOne({ userId: owner, status: 'open' })
        .select('+current.correctAnswer')
        .lean<GateRunRow>();
      const current = run?.current;
      if (!run || !current || current.challengeId.toHexString() !== request.challengeId) {
        throw gateChallengeStale();
      }
      if (expired(current.servedAt, clock())) throw gateChallengeStale();
      if (request.selectedIndex >= current.optionCount) {
        // Nothing is consumed: the index cannot belong to the served question.
        throw validation([
          { location: 'body', path: 'selectedIndex', message: 'is not one of the options' },
        ]);
      }

      const correct = request.selectedIndex === current.correctAnswer;
      const attemptNumber = run.attemptsUsed + 1;
      const outcome = correct ? 'pass' : attemptNumber >= run.maxAttempts ? 'restrict' : 'next';
      const now = clock();

      // Grading always persists first (P5-M2). The next question is drawn before the write only to
      // fill current; if none can be drawn the answer is still graded and consumed, the run is
      // left without a live challenge and the NEXT challenge request answers 503. A wrong answer
      // therefore never costs nothing, whatever the state of the content.
      let next: DrawnQuestion | null = null;
      if (outcome === 'next') {
        try {
          next = await drawQuestion(owner, run.servedQuestionIds, run.maxAttempts);
        } catch (err) {
          logger.warn(
            { err, runId: run._id.toHexString() },
            'No next gate question; run left open',
          );
        }
      }

      const set: Record<string, unknown> = {};
      if (run.attemptsUsed === 0) set.firstAnswerCorrect = correct;
      const nextChallengeId = new Types.ObjectId();
      if (outcome === 'pass') {
        Object.assign(set, {
          status: 'passed',
          clearedUntil: new Date(now.getTime() + deps.gate.clearanceTtlSeconds * 1000),
          closedAt: now,
          current: null,
        });
      } else if (outcome === 'restrict') {
        Object.assign(set, { status: 'restricted', closedAt: now, current: null });
      } else {
        set.current = next ? currentFor(next, nextChallengeId, now) : null;
      }

      // Compare-and-set (S12, S13): only the request that still sees this exact challenge and
      // attempt count wins. Everything else is a replay or a lost race.
      const updated = await GateRun.findOneAndUpdate(
        {
          _id: run._id,
          status: 'open',
          'current.challengeId': current.challengeId,
          attemptsUsed: run.attemptsUsed,
        },
        {
          $set: set,
          $inc: { attemptsUsed: 1, version: 1 },
          ...(next ? { $push: { servedQuestionIds: next.id } } : {}),
        },
        { returnDocument: 'after' },
      ).lean<GateRunRow>();
      if (!updated) throw gateChallengeStale();

      try {
        await GateAnswer.create({
          userId: owner,
          runId: run._id,
          attemptIndex: attemptNumber,
          challengeId: current.challengeId,
          questionId: current.questionId,
          selectedIndex: request.selectedIndex,
          correct,
          answeredAt: now,
        });
      } catch (err) {
        // The run already decided the outcome; the answer row is history. Never fail the response.
        if (!isDuplicateKey(err)) {
          logger.error({ err, runId: run._id.toHexString() }, 'Gate answer record failed');
        }
      }

      const answered = await GateQuestion.findById(current.questionId)
        .select('+explanation')
        .lean<{ explanation?: string }>();
      const explanation = answered?.explanation ?? FALLBACK_EXPLANATION;

      if (outcome === 'pass') {
        const xpEarned = await passEffects(userId, run._id.toHexString());
        const until = updated.clearedUntil ?? now;
        return { correct, explanation, xpEarned, status: grantedStatus(updated, until) };
      }
      if (outcome === 'restrict') {
        await restrictionEffects(userId, updated);
        return { correct, explanation, xpEarned: 0, status: restrictedStatus(updated, tz) };
      }
      return {
        correct,
        explanation,
        xpEarned: 0,
        status: next
          ? challengeStatus(updated, nextChallengeId, next)
          : {
              ...requiredStatus(updated.maxAttempts),
              attemptsRemaining: Math.max(0, updated.maxAttempts - updated.attemptsUsed),
            },
      };
    },

    async reportOfflineRelease(userId, request, ctx) {
      const now = clock();
      const releasedAt = new Date(request.releasedAt);
      const skewMs = GATE_OFFLINE_FUTURE_SKEW_SECONDS * 1000;
      const maxAgeMs = GATE_OFFLINE_MAX_AGE_DAYS * 86_400_000;
      if (releasedAt.getTime() > now.getTime() + skewMs) {
        throw validation([{ location: 'body', path: 'releasedAt', message: 'is in the future' }]);
      }
      if (now.getTime() - releasedAt.getTime() > maxAgeMs) {
        throw validation([
          {
            location: 'body',
            path: 'releasedAt',
            message: `is more than ${String(GATE_OFFLINE_MAX_AGE_DAYS)} days old`,
          },
        ]);
      }
      const owner = new Types.ObjectId(userId);
      const restricted = await GateRun.findOne({
        userId: owner,
        status: 'restricted',
        restoredAt: null,
      })
        .sort({ closedAt: -1, _id: -1 })
        .lean<GateRunRow>();
      // Idempotent per user and instant: a replay is the same report.
      const key = `gate:offline_release:${userId}:${String(releasedAt.getTime())}`;
      const recorded = await audit.record({
        action: 'gate.offline_release',
        outcome: 'success',
        severity: 'warning',
        actor: { id: owner, role: 'employee' },
        target: { type: 'user', id: owner },
        ctx,
        idempotencyKey: key,
        metadata: {
          releasedAt: releasedAt.toISOString(),
          reason: request.reason,
          ...(request.durationSeconds === undefined
            ? {}
            : { durationSeconds: request.durationSeconds }),
          restricted: restricted !== null,
        },
      });

      // A restricted employee who got in offline is a security event: tell the security team on
      // their restriction escalation (opened first if it is somehow missing). Each step is
      // idempotent, so a replay after a partial failure completes it.
      let escalated = false;
      if (restricted) {
        const runId = restricted._id.toHexString();
        const escalationId =
          restricted.escalationId?.toHexString() ??
          (
            await deps.escalations.recordCriticalEvent({
              userId,
              reason: 'gate_access_restricted',
              sourceRef: { type: 'gate_event', id: runId },
              occurredAt: restricted.closedAt ?? restricted.openedAt,
            })
          ).escalationId;
        await GateRun.updateOne(
          { _id: restricted._id, escalationId: null },
          { $set: { escalationId: new Types.ObjectId(escalationId) } },
        );
        const refId = sha256(key).slice(0, 24);
        escalated = await deps.escalations.recordRetrigger(escalationId, refId);
      }
      return {
        created: !recorded.duplicate,
        result: { recorded: true, duplicate: recorded.duplicate, escalated },
      };
    },
  };
}
