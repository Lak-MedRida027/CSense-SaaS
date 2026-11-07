import type { Logger } from 'pino';
import type { BadgesService } from '../gamification/badges.service.js';
import type { XpService } from '../gamification/xp.service.js';
import type {
  AttemptEffects,
  AttemptRecordedEvent,
  FinalTestPassedEvent,
  LearningHooks,
  ModuleCompletedEvent,
} from '../learning/learningHooks.js';
import type { MarkerService, ReconcileReason } from '../maintenance/markers.js';
import type { RiskService } from '../risk/risk.service.js';

export interface LearningEffectsDeps {
  xp: XpService;
  badges: BadgesService;
  risk: RiskService;
  markers: MarkerService;
  logger: Logger;
}

/**
 * XP, badges and risk behind the learning hooks seam (ADR 0008). Each concern runs on its own: one
 * failing never drops the others or fails the submission. A failure is logged and leaves a
 * reconcile marker so the sweeper repairs it. Every concern is idempotent, so a redelivered event
 * changes nothing.
 */
export function createLearningEffects(deps: LearningEffectsDeps): LearningHooks {
  async function safe<T>(
    kind: ReconcileReason,
    userId: string,
    attemptId: string,
    run: () => Promise<T>,
  ): Promise<T | undefined> {
    try {
      return await run();
    } catch (err) {
      deps.logger.error(
        { event: 'learning_effect_failed', kind, userId, attemptId, err },
        'Learning effect failed; left for reconciliation',
      );
      await deps.markers.mark(userId, kind);
      return undefined;
    }
  }

  return {
    async onAttemptRecorded(e: AttemptRecordedEvent): Promise<AttemptEffects | undefined> {
      await safe('risk', e.userId, e.attemptId, () =>
        deps.risk.recomputeForUser(e.userId, { type: 'attempt', refId: e.attemptId }),
      );
      return undefined;
    },

    async onModuleCompleted(e: ModuleCompletedEvent): Promise<AttemptEffects | undefined> {
      const badge = await safe('badge', e.userId, e.attemptId, () =>
        deps.badges.awardForModule(e.userId, e.moduleId, e.attemptId, e.at),
      );
      const xp = await safe('xp', e.userId, e.attemptId, () =>
        deps.xp.recomputeXp(e.userId, { attemptId: e.attemptId }),
      );
      return {
        ...(xp ? { xpEarned: xp.xpEarned } : {}),
        ...(badge ? { badge } : {}),
      };
    },

    async onFinalTestPassed(e: FinalTestPassedEvent): Promise<AttemptEffects | undefined> {
      const xp = await safe('xp', e.userId, e.attemptId, () =>
        deps.xp.recomputeXp(e.userId, { attemptId: e.attemptId }),
      );
      return xp ? { xpEarned: xp.xpEarned } : {};
    },
  };
}
