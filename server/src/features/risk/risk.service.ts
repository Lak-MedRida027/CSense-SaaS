import { Types } from 'mongoose';
import type { Logger } from 'pino';
import {
  computeRiskProfile,
  decideRiskTransition,
  type RiskLevel,
  type RiskResult,
} from '@csense/shared';
import { Employee, RiskAssessment, RiskProfile } from '../../models/index.js';
import { audit } from '../audit/audit.service.js';
import type { EscalationService } from '../governance/escalation.service.js';
import { digestFacts, loadRiskFacts } from './riskFacts.service.js';

export type RiskTrigger =
  | { type: 'attempt'; refId: string }
  | { type: 'critical_event'; refId: string | null }
  | { type: 'gate_run'; refId: string }
  | { type: 'reconcile' | 'model_upgrade' | 'config_change'; refId?: null };

export interface RecomputeOutcome {
  result: RiskResult | null;
  /** True when a new assessment was stored. */
  changed: boolean;
  assessmentId: string | null;
}

export interface RiskService {
  /**
   * Recompute the employee profile from the facts in the database and store it if anything
   * changed (compare-and-set on `rev`). Entering High opens an escalation; a level change is
   * audited. Administrators have no profile. Safe to call any number of times, concurrently.
   */
  recomputeForUser(userId: string, trigger: RiskTrigger): Promise<RecomputeOutcome>;
  /** True when the stored profile differs from the pure result over the current facts (writes nothing). */
  hasDrift(userId: string): Promise<boolean>;
}

export interface RiskServiceDeps {
  clock: () => Date;
  logger: Logger;
  phishingEnabled: boolean;
  escalations: EscalationService;
}

const MAX_TRIES = 3;

interface StoredProfile {
  rev: number;
  riskLevel?: RiskLevel | null | undefined;
  compositeScore?: number | null | undefined;
  knowledgeScore?: number | null | undefined;
  behaviouralScore?: number | null | undefined;
  simulationScore?: number | null | undefined;
  engagementScore?: number | null | undefined;
  coverage?: Record<string, string> | null | undefined;
  modelVersion?: number | null | undefined;
  highEpisodeId?: Types.ObjectId | null | undefined;
}

const sameCoverage = (
  stored: Record<string, string> | null | undefined,
  next: Record<string, string>,
): boolean =>
  stored !== null &&
  stored !== undefined &&
  ['knowledge', 'behavioural', 'simulation', 'engagement'].every((d) => stored[d] === next[d]);

const sameState = (p: StoredProfile, r: RiskResult): boolean =>
  (p.knowledgeScore ?? null) === r.scores.knowledge &&
  (p.behaviouralScore ?? null) === r.scores.behavioural &&
  (p.simulationScore ?? null) === r.scores.simulation &&
  (p.engagementScore ?? null) === r.scores.engagement &&
  (p.compositeScore ?? null) === r.compositeScore &&
  (p.riskLevel ?? null) === r.riskLevel &&
  p.modelVersion === r.modelVersion &&
  sameCoverage(p.coverage, r.coverage);

const isDuplicateKey = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;

export function createRiskService(deps: RiskServiceDeps): RiskService {
  async function attempt(
    userId: string,
    trigger: RiskTrigger,
  ): Promise<RecomputeOutcome | 'conflict'> {
    const owner = new Types.ObjectId(userId);
    // Facts are read AFTER the profile, so the writer that wins the compare-and-set below used the
    // freshest facts available at that point.
    const profile = await RiskProfile.findOne({ userId: owner }).lean<StoredProfile>();
    const facts = await loadRiskFacts(userId, { phishingEnabled: deps.phishingEnabled });
    const result = computeRiskProfile(facts);
    if (profile && sameState(profile, result)) {
      return { result, changed: false, assessmentId: null };
    }

    const now = deps.clock();
    const assessmentId = new Types.ObjectId();
    const previousLevel = profile?.riskLevel ?? null;
    const transition = decideRiskTransition(previousLevel, result.riskLevel);
    const leavingHigh = previousLevel === 'High' && result.riskLevel !== 'High';
    const set = {
      knowledgeScore: result.scores.knowledge,
      behaviouralScore: result.scores.behavioural,
      simulationScore: result.scores.simulation,
      engagementScore: result.scores.engagement,
      compositeScore: result.compositeScore,
      riskLevel: result.riskLevel,
      coverage: result.coverage,
      effectiveWeightsBp: result.effectiveWeightsBp,
      evidence: result.evidence,
      modelVersion: result.modelVersion,
      lastAssessmentId: assessmentId,
      computedAt: now,
      highEpisodeId: transition.escalate
        ? assessmentId
        : leavingHigh
          ? null
          : (profile?.highEpisodeId ?? null),
    };

    let newRev: number;
    if (profile) {
      const updated = await RiskProfile.findOneAndUpdate(
        { userId: owner, rev: profile.rev },
        { $set: set, $inc: { rev: 1 } },
        { returnDocument: 'after' },
      ).lean<{ rev: number }>();
      if (!updated) return 'conflict';
      newRev = updated.rev;
    } else {
      try {
        await RiskProfile.create({ userId: owner, ...set, rev: 1 });
      } catch (err) {
        if (isDuplicateKey(err)) return 'conflict';
        throw err;
      }
      newRev = 1;
    }

    await RiskAssessment.create({
      _id: assessmentId,
      userId: owner,
      profileRev: newRev,
      modelVersion: result.modelVersion,
      scores: result.scores,
      compositeScore: result.compositeScore,
      riskLevel: result.riskLevel,
      previousLevel,
      levelChanged: transition.levelChanged,
      coverage: result.coverage,
      effectiveWeightsBp: result.effectiveWeightsBp,
      evidence: result.evidence,
      inputsDigest: digestFacts(facts),
      trigger: {
        type: trigger.type,
        refId: trigger.refId ? new Types.ObjectId(trigger.refId) : null,
      },
      computedAt: now,
    });

    if (transition.levelChanged) {
      await audit.record({
        action: 'risk.level_changed',
        outcome: 'success',
        severity: transition.auditSeverity,
        target: { type: 'user', id: owner },
        idempotencyKey: `risk:${assessmentId.toHexString()}:level_changed`,
        metadata: {
          from: previousLevel,
          to: result.riskLevel,
          compositeScore: result.compositeScore,
          riskAssessmentId: assessmentId.toHexString(),
          modelVersion: result.modelVersion,
          trigger: trigger.type,
        },
      });
    }
    if (transition.escalate) {
      await deps.escalations.openForRiskHigh({
        userId,
        assessmentId: assessmentId.toHexString(),
        riskLevel: result.riskLevel,
        previousLevel,
        compositeScore: result.compositeScore,
        scores: result.scores,
        coverage: result.coverage,
        modelVersion: result.modelVersion,
      });
    }
    return { result, changed: true, assessmentId: assessmentId.toHexString() };
  }

  return {
    async hasDrift(userId) {
      if ((await Employee.exists({ _id: new Types.ObjectId(userId) })) === null) return false;
      const profile = await RiskProfile.findOne({
        userId: new Types.ObjectId(userId),
      }).lean<StoredProfile>();
      const result = computeRiskProfile(
        await loadRiskFacts(userId, { phishingEnabled: deps.phishingEnabled }),
      );
      return !profile || !sameState(profile, result);
    },

    async recomputeForUser(userId, trigger) {
      // Only employees have a profile.
      if ((await Employee.exists({ _id: new Types.ObjectId(userId) })) === null) {
        return { result: null, changed: false, assessmentId: null };
      }
      let outcome: RecomputeOutcome | null = null;
      for (let tries = 0; tries < MAX_TRIES && outcome === null; tries += 1) {
        const next = await attempt(userId, trigger);
        if (next !== 'conflict') outcome = next;
      }
      if (outcome === null) {
        throw new Error('Risk profile update kept conflicting; try again');
      }
      // Repeated quiz failures are flagged whether or not the profile itself changed.
      await deps.escalations.evaluateCooldowns(userId);
      // ...and so is an employee who is still unassessed long after their account was created.
      await deps.escalations.evaluateDisengagement(userId);
      return outcome;
    },
  };
}
