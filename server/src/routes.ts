import type { AppConfig } from './config/appConfig.js';
import { authRoutes } from './features/auth/auth.routes.js';
import type { AuthDeps } from './features/auth/auth.service.js';
import type { FailedLoginFloor, Timing } from './features/auth/failedLoginDelay.js';
import { configRoutes } from './features/config/config.routes.js';
import { learningRoutes } from './features/learning/learning.routes.js';
import { noopLearningHooks, type LearningHooks } from './features/learning/learningHooks.js';
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
  /** Phase 4 plugs XP, badges and the risk engine in here (ADR 0008). Defaults to no-ops. */
  learningHooks?: LearningHooks;
  /** Test seam for the question-order shuffle. */
  shuffle?: Shuffle;
  logger?: Logger;
}

/** The complete route table. Nothing is reachable unless it appears here with an `access`. */
export function allRoutes({
  config,
  clock,
  isReady,
  timing,
  floor,
  onCredentialsFailure,
  learningHooks = noopLearningHooks,
  shuffle = secureShuffle,
  logger = createLogger('silent'),
}: RouteDeps): RouteDef[] {
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
      hooks: learningHooks,
      logger,
      shuffle,
    }),
  ];
}
