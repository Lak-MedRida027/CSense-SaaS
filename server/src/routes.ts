import type { AppConfig } from './config/appConfig.js';
import { authRoutes } from './features/auth/auth.routes.js';
import type { AuthDeps } from './features/auth/auth.service.js';
import type { FailedLoginFloor, Timing } from './features/auth/failedLoginDelay.js';
import { configRoutes } from './features/config/config.routes.js';
import { healthRoutes } from './features/health/health.routes.js';
import { usersRoutes } from './features/users/users.routes.js';
import type { RouteDef } from './http/routeRegistry.js';

export interface RouteDeps {
  config: AppConfig;
  clock: () => Date;
  isReady: () => boolean;
  /** Test seam for the failed-login response-time floor. */
  timing?: Timing;
  floor?: FailedLoginFloor;
  onCredentialsFailure?: (email: string) => void;
}

/** The complete route table. Nothing is reachable unless it appears here with an `access`. */
export function allRoutes({
  config,
  clock,
  isReady,
  timing,
  floor,
  onCredentialsFailure,
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
  ];
}
