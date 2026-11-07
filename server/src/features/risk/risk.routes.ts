import { listRiskProfilesQuerySchema, userIdParamsSchema } from '@csense/shared';
import { ADMIN_ONLY, defineRoute, type RouteDef } from '../../http/routeRegistry.js';
import { getRiskProfileDetail, listRiskProfiles } from './risk.read.js';

/**
 * Administrator-only reads of stored risk profiles. They never recompute and never accept an
 * employee token: employees do not see their own risk (D4-22).
 */
export function riskRoutes(): RouteDef[] {
  return [
    defineRoute({
      method: 'get',
      path: '/admin/risk-profiles',
      access: ADMIN_ONLY,
      schemas: { query: listRiskProfilesQuerySchema },
      handler: (ctx) => listRiskProfiles(ctx.query),
    }),
    defineRoute({
      method: 'get',
      path: '/admin/users/:userId/risk-profile',
      access: ADMIN_ONLY,
      schemas: { params: userIdParamsSchema },
      handler: (ctx) => getRiskProfileDetail(ctx.params.userId),
    }),
  ];
}
