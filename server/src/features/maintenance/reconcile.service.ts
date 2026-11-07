import { Types } from 'mongoose';
import type { Logger } from 'pino';
import {
  Badge,
  BadgeAward,
  Employee,
  Escalation,
  AuditLog,
  QuizAttempt,
  RiskAssessment,
  RiskProfile,
  UserProgress,
} from '../../models/index.js';
import { audit } from '../audit/audit.service.js';
import type { EscalationService } from '../governance/escalation.service.js';
import type { BadgesService } from '../gamification/badges.service.js';
import type { XpService } from '../gamification/xp.service.js';
import { loadXpFacts } from '../gamification/xpFacts.service.js';
import { digestFacts, loadRiskFacts } from '../risk/riskFacts.service.js';
import type { RiskService, RiskTrigger } from '../risk/risk.service.js';
import { computeXp, type RiskLevel } from '@csense/shared';

export interface ReconcileOptions {
  dryRun?: boolean;
  /** Set XP unconditionally (after a rule change) instead of only raising it. */
  forceXp?: boolean;
  trigger?: Extract<RiskTrigger, { type: 'reconcile' | 'model_upgrade' | 'config_change' }>;
}

export interface ReconcileDiff {
  userId: string;
  badgesAwarded: number;
  xpChanged: boolean;
  xpBefore: number;
  xpAfter: number;
  riskRecomputed: boolean;
  escalationRepaired: boolean;
  assessmentRepaired: boolean;
  auditWritten: number;
  /** Anything at all that was (or, in a dry run, would be) fixed. */
  drift: boolean;
}

export interface ReconcileService {
  reconcileUser(userId: string, opts?: ReconcileOptions): Promise<ReconcileDiff>;
  reconcileAll(
    opts?: ReconcileOptions,
  ): Promise<{ users: number; drifted: number; diffs: ReconcileDiff[] }>;
}

export interface ReconcileDeps {
  logger: Logger;
  clock: () => Date;
  xp: XpService;
  badges: BadgesService;
  risk: RiskService;
  escalations: EscalationService;
  phishingEnabled: boolean;
}

interface ProfileRow {
  riskLevel?: RiskLevel | null;
  highEpisodeId?: Types.ObjectId | null;
  lastAssessmentId?: Types.ObjectId | null;
  compositeScore?: number | null;
  knowledgeScore?: number | null;
  behaviouralScore?: number | null;
  simulationScore?: number | null;
  engagementScore?: number | null;
  coverage?: Record<string, string> | null;
  effectiveWeightsBp?: Record<string, number> | null;
  evidence?: Record<string, unknown> | null;
  modelVersion?: number | null;
  rev: number;
  computedAt?: Date | null;
}

export function createReconcileService(deps: ReconcileDeps): ReconcileService {
  async function reconcileUser(
    userId: string,
    opts: ReconcileOptions = {},
  ): Promise<ReconcileDiff> {
    const dryRun = opts.dryRun === true;
    const owner = new Types.ObjectId(userId);
    const diff: ReconcileDiff = {
      userId,
      badgesAwarded: 0,
      xpChanged: false,
      xpBefore: 0,
      xpAfter: 0,
      riskRecomputed: false,
      escalationRepaired: false,
      assessmentRepaired: false,
      auditWritten: 0,
      drift: false,
    };
    const employee = await Employee.findById(owner).select('totalXP').lean();
    if (!employee) return diff;

    // 1. Badges for every passed module that has a badge and no award.
    const facts = await loadXpFacts(userId);
    for (const m of facts.modules) {
      if (!m.passingAttempt) continue;
      const badge = await Badge.findOne({ moduleId: new Types.ObjectId(m.moduleId) }).lean();
      if (!badge) continue;
      if (await BadgeAward.exists({ userId: owner, badgeId: badge._id })) continue;
      diff.badgesAwarded += 1;
      if (dryRun) continue;
      const [progress, attempt] = await Promise.all([
        UserProgress.findOne({ userId: owner, moduleId: badge.moduleId })
          .select('completedAt')
          .lean(),
        QuizAttempt.findById(m.passingAttempt.attemptId).select('attemptedAt').lean(),
      ]);
      await deps.badges.awardForModule(
        userId,
        m.moduleId,
        m.passingAttempt.attemptId,
        progress?.completedAt ?? attempt?.attemptedAt ?? deps.clock(),
        'reconcile',
      );
    }

    // 2. XP: the projection only goes up, unless forced.
    diff.xpBefore = employee.totalXP || 0;
    const expected = computeXp(facts).total;
    const differs = opts.forceXp ? expected !== diff.xpBefore : expected > diff.xpBefore;
    diff.xpAfter = differs ? expected : diff.xpBefore;
    diff.xpChanged = differs;
    if (differs && !dryRun) {
      await deps.xp.recomputeXp(userId, { force: opts.forceXp === true });
    }

    // 3. Risk profile, the High-episode escalation and the assessment pointer.
    diff.riskRecomputed = await deps.risk.hasDrift(userId);
    if (diff.riskRecomputed && !dryRun) {
      await deps.risk.recomputeForUser(userId, opts.trigger ?? { type: 'reconcile' });
    }
    const profile = await RiskProfile.findOne({ userId: owner }).lean<ProfileRow>();
    if (profile?.riskLevel === 'High' && profile.highEpisodeId) {
      const episode = profile.highEpisodeId;
      const covered = await Escalation.exists({
        userId: owner,
        reason: 'risk_level_high',
        $or: [
          { dedupeKey: `risk_level_high:${userId}:${episode.toHexString()}` },
          { 'events.eventId': episode },
        ],
      });
      if (!covered) {
        diff.escalationRepaired = true;
        if (!dryRun) {
          const scores = {
            knowledge: profile.knowledgeScore ?? null,
            behavioural: profile.behaviouralScore ?? null,
            simulation: profile.simulationScore ?? null,
            engagement: profile.engagementScore ?? null,
          };
          await deps.escalations.openForRiskHigh({
            userId,
            assessmentId: episode.toHexString(),
            riskLevel: 'High',
            previousLevel: null,
            compositeScore: profile.compositeScore ?? null,
            scores,
            coverage: (profile.coverage ?? {}) as never,
            modelVersion: profile.modelVersion ?? 1,
          });
        }
      }
    }
    if (
      profile?.lastAssessmentId &&
      !(await RiskAssessment.exists({ _id: profile.lastAssessmentId }))
    ) {
      diff.assessmentRepaired = true;
      if (!dryRun && profile.coverage && profile.effectiveWeightsBp && profile.evidence) {
        const riskFacts = await loadRiskFacts(userId, { phishingEnabled: deps.phishingEnabled });
        await RiskAssessment.create({
          _id: profile.lastAssessmentId,
          userId: owner,
          profileRev: Math.max(1, profile.rev),
          modelVersion: profile.modelVersion ?? 1,
          scores: {
            knowledge: profile.knowledgeScore ?? null,
            behavioural: profile.behaviouralScore ?? null,
            simulation: profile.simulationScore ?? null,
            engagement: profile.engagementScore ?? null,
          },
          compositeScore: profile.compositeScore ?? null,
          riskLevel: profile.riskLevel ?? null,
          previousLevel: null,
          levelChanged: false,
          coverage: profile.coverage,
          effectiveWeightsBp: profile.effectiveWeightsBp,
          evidence: profile.evidence,
          inputsDigest: digestFacts(riskFacts),
          trigger: { type: 'reconcile', refId: null },
          computedAt: profile.computedAt ?? deps.clock(),
        });
      }
    }

    // 4. Audit outbox: escalation events and level changes whose audit entry is missing.
    const unaudited = await Escalation.find({ userId: owner, 'events.audited': false })
      .select('_id')
      .lean();
    for (const e of unaudited) {
      if (dryRun) diff.auditWritten += 1;
      else diff.auditWritten += await deps.escalations.flushAudit(e._id.toHexString());
    }
    const changes = await RiskAssessment.find({ userId: owner, levelChanged: true }).lean();
    for (const c of changes) {
      const key = `risk:${c._id.toHexString()}:level_changed`;
      if (await AuditLog.exists({ idempotencyKey: key })) continue;
      if (dryRun) {
        diff.auditWritten += 1;
        continue;
      }
      const result = await audit.record({
        action: 'risk.level_changed',
        outcome: 'success',
        severity: c.riskLevel === 'High' || c.riskLevel === 'Medium' ? 'warning' : 'info',
        target: { type: 'user', id: owner },
        idempotencyKey: key,
        metadata: {
          from: c.previousLevel ?? null,
          to: c.riskLevel ?? null,
          compositeScore: c.compositeScore ?? null,
          riskAssessmentId: c._id.toHexString(),
          modelVersion: c.modelVersion,
          trigger: c.trigger.type,
        },
      });
      if (!result.duplicate) diff.auditWritten += 1;
    }

    diff.drift =
      diff.badgesAwarded > 0 ||
      diff.xpChanged ||
      diff.riskRecomputed ||
      diff.escalationRepaired ||
      diff.assessmentRepaired ||
      diff.auditWritten > 0;
    return diff;
  }

  return {
    reconcileUser,
    async reconcileAll(opts = {}) {
      const diffs: ReconcileDiff[] = [];
      let users = 0;
      for await (const e of Employee.find({}).select('_id').cursor()) {
        users += 1;
        const diff = await reconcileUser(e._id.toHexString(), opts);
        if (diff.drift) diffs.push(diff);
      }
      return { users, drifted: diffs.length, diffs };
    },
  };
}
