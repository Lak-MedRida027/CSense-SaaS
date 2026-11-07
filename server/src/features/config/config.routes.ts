import type { FeatureFlags } from '@csense/shared';
import { AUTHENTICATED, defineRoute, type RouteDef } from '../../http/routeRegistry.js';

export function configRoutes(features: FeatureFlags): RouteDef[] {
  return [
    defineRoute({
      method: 'get',
      path: '/config/features',
      access: AUTHENTICATED,
      handler: (): FeatureFlags => ({ ...features }),
    }),
  ];
}
