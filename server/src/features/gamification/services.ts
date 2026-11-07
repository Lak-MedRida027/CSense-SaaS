import type { Logger } from 'pino';
import type { AppConfig } from '../../config/appConfig.js';
import { createLearningEffects } from '../effects/learningEffects.js';
import {
  createEscalationService,
  type EscalationService,
} from '../governance/escalation.service.js';
import {
  createLogNotifier,
  safeNotifier,
  type SecurityTeamNotifier,
} from '../governance/notifier.js';
import type { LearningHooks } from '../learning/learningHooks.js';
import { createMarkerService, type MarkerService } from '../maintenance/markers.js';
import { createReconcileService, type ReconcileService } from '../maintenance/reconcile.service.js';
import { createSweeper, type Sweeper } from '../maintenance/sweeper.js';
import { createRiskService, type RiskService } from '../risk/risk.service.js';
import { createBadgesService, type BadgesService } from './badges.service.js';
import { createXpService, type XpService } from './xp.service.js';

export interface GamificationServices {
  xp: XpService;
  badges: BadgesService;
  risk: RiskService;
  escalations: EscalationService;
  markers: MarkerService;
  reconcile: ReconcileService;
  sweeper: Sweeper;
  /** XP, badges and risk behind the learning hooks. */
  hooks: LearningHooks;
}

export interface GamificationDeps {
  config: AppConfig;
  clock: () => Date;
  logger: Logger;
  notifier?: SecurityTeamNotifier;
}

/** Wire the Phase 4 services together. One instance per app; tests build their own. */
export function createGamificationServices(deps: GamificationDeps): GamificationServices {
  const { config, clock, logger } = deps;
  const markers = createMarkerService({ logger });
  const notifier = safeNotifier(deps.notifier ?? createLogNotifier(logger), logger);
  const xp = createXpService();
  const badges = createBadgesService({ logger });
  const escalations = createEscalationService({
    clock,
    logger,
    notifier,
    features: config.features,
    governance: config.governance,
    markers,
  });
  const risk = createRiskService({
    clock,
    logger,
    phishingEnabled: config.features.phishing,
    escalations,
  });
  const reconcile = createReconcileService({
    logger,
    clock,
    xp,
    badges,
    risk,
    escalations,
    phishingEnabled: config.features.phishing,
  });
  const sweeper = createSweeper({ logger, clock, reconcile, escalations });
  const hooks = createLearningEffects({ xp, badges, risk, markers, logger });
  return { xp, badges, risk, escalations, markers, reconcile, sweeper, hooks };
}
