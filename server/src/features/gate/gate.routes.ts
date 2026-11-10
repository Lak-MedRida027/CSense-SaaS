import {
  gateAttemptRequestSchema,
  gateOfflineReleaseRequestSchema,
  restoreAccessParamsSchema,
  restoreAccessRequestSchema,
  type GateAttemptResultDTO,
  type GateOfflineReleaseResultDTO,
  type GateStatusDTO,
  type RestoreAccessDTO,
} from '@csense/shared';
import {
  ADMIN_ONLY,
  EMPLOYEE_ONLY,
  defineRoute,
  requireAuth,
  type RouteDef,
} from '../../http/routeRegistry.js';
import type { GateService } from './gate.service.js';
import type { RestoreService } from './restore.service.js';

/**
 * Thin controllers (Phase 5, 4 routes). The gate routes are employee-only and take identity from
 * the token alone. Status and challenge stay reachable while the employee is restricted, so the
 * desktop can show the restricted screen and notice a restore; attempts cannot.
 */
export function gateRoutes(deps: { gate: GateService; restore: RestoreService }): RouteDef[] {
  return [
    defineRoute({
      method: 'get',
      path: '/gate/status',
      access: EMPLOYEE_ONLY,
      allowWhileRestricted: true,
      handler: (ctx): Promise<GateStatusDTO> => deps.gate.getStatus(requireAuth(ctx).userId),
    }),
    defineRoute({
      method: 'post',
      path: '/gate/challenge',
      access: EMPLOYEE_ONLY,
      allowWhileRestricted: true,
      handler: (ctx): Promise<GateStatusDTO> => deps.gate.openChallenge(requireAuth(ctx).userId),
    }),
    defineRoute({
      method: 'post',
      path: '/gate/attempts',
      access: EMPLOYEE_ONLY,
      schemas: { body: gateAttemptRequestSchema },
      handler: async (ctx, _req, res): Promise<void> => {
        const result: GateAttemptResultDTO = await deps.gate.submitAttempt(
          requireAuth(ctx).userId,
          ctx.body,
        );
        res.status(201).json(result);
      },
    }),
    defineRoute({
      method: 'post',
      path: '/gate/offline-releases',
      access: EMPLOYEE_ONLY,
      // A restricted employee who got in offline must still be able to report it.
      allowWhileRestricted: true,
      limiter: 'gateReport',
      schemas: { body: gateOfflineReleaseRequestSchema },
      handler: async (ctx, _req, res): Promise<void> => {
        const { result, created } = await deps.gate.reportOfflineRelease(
          requireAuth(ctx).userId,
          ctx.body,
          { ip: ctx.ip, userAgent: ctx.userAgent, requestId: ctx.requestId },
        );
        res.status(created ? 201 : 200).json(result satisfies GateOfflineReleaseResultDTO);
      },
    }),
    defineRoute({
      method: 'post',
      path: '/admin/users/:userId/restore-access',
      access: ADMIN_ONLY,
      schemas: { params: restoreAccessParamsSchema, body: restoreAccessRequestSchema },
      handler: (ctx): Promise<RestoreAccessDTO> =>
        deps.restore.restoreAccess(requireAuth(ctx).userId, ctx.params.userId, ctx.body.note, {
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          requestId: ctx.requestId,
        }),
    }),
  ];
}
