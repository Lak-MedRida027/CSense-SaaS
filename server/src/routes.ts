import type { AppConfig } from './config/appConfig.js';
import { authRoutes } from './features/auth/auth.routes.js';
import type { AuthDeps } from './features/auth/auth.service.js';
import type { FailedLoginFloor, Timing } from './features/auth/failedLoginDelay.js';
import { auditLogRoutes } from './features/audit/auditLogs.routes.js';
import { gamificationRoutes } from './features/gamification/gamification.routes.js';
import {
  createGamificationServices,
  type GamificationServices,
} from './features/gamification/services.js';
import { escalationRoutes } from './features/governance/escalations.routes.js';
import { riskRoutes } from './features/risk/risk.routes.js';
import { configRoutes } from './features/config/config.routes.js';
import { learningRoutes } from './features/learning/learning.routes.js';
import type { LearningHooks } from './features/learning/learningHooks.js';
import { secureShuffle, type Shuffle } from './features/learning/shuffle.js';
import { healthRoutes } from './features/health/health.routes.js';
import { usersRoutes } from './features/users/users.routes.js';
import type { RouteDef } from './http/routeRegistry.js';
import { createLogger } from './lib/logger.js';
import type { Logger } from 'pino';

export interface RouteDeps {
  config: AppConfig;
  clock: () => Date;
  isReady: () => boolean | Promise<boolean>;
  /** Test seam for the failed-login response-time floor. */
  timing?: Timing;
  floor?: FailedLoginFloor;
  onCredentialsFailure?: (email: string) => void;
  /** Replaces the XP, badge and risk hooks (tests inject spies). Defaults to the real effects. */
  learningHooks?: LearningHooks;
  /** Test seam for the question-order shuffle. */
  shuffle?: Shuffle;
  logger?: Logger;
  /** XP, badges, risk and governance services. Built from `config` when omitted. */
  gamification?: GamificationServices;
}

/** The complete route table. Nothing is reachable unless it appears here with an `access`. */
export function allRoutes({
  config,
  clock,
  isReady,
  timing,
  floor,
  onCredentialsFailure,
  learningHooks,
  shuffle = secureShuffle,
  logger = createLogger('silent'),
  gamification = createGamificationServices({ config, clock, logger }),
}: RouteDeps): RouteDef[] {
  const hooks = learningHooks ?? gamification.hooks;
  const authDeps: AuthDeps = {
    config,
    clock,
    ...(timing ? { timing } : {}),
    ...(floor ? { floor } : {}),
    ...(onCredentialsFailure ? { onCredentialsFailure } : {}),
  };
  return [
    ...healthRoutes(isReady),
    ...authRoutes(authDeps),
    ...usersRoutes({ bcryptCost: config.bcryptCost }),
    ...configRoutes(config.features),
    ...learningRoutes({
      clock,
      sessionTtlSeconds: config.learning.sessionTtlSeconds,
      hookTimeoutMs: config.learning.hookTimeoutMs,
      startReuseSeconds: config.learning.startReuseSeconds,
      cooldownAfterFails: config.learning.cooldownAfterFails,
      cooldownMinutes: config.learning.cooldownMinutes,
      hooks,
      logger,
      shuffle,
    }),
    ...gamificationRoutes({ badges: gamification.badges }),
    ...riskRoutes(),
    ...escalationRoutes({ escalations: gamification.escalations }),
    ...auditLogRoutes(),
  ];
}
