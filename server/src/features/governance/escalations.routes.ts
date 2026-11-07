import {
  escalationActionRequestSchema,
  escalationParamsSchema,
  listEscalationsQuerySchema,
} from '@csense/shared';
import { ADMIN_ONLY, defineRoute, requireAuth, type RouteDef } from '../../http/routeRegistry.js';
import { getEscalation, listEscalations, toDetail } from './escalation.read.js';
import type { EscalationService } from './escalation.service.js';

/** Thin controllers: every decision lives in the escalation service. Administrator-only. */
export function escalationRoutes(deps: { escalations: EscalationService }): RouteDef[] {
  return [
    defineRoute({
      method: 'get',
      path: '/admin/escalations',
      access: ADMIN_ONLY,
      schemas: { query: listEscalationsQuerySchema },
      handler: (ctx) => listEscalations(ctx.query),
    }),
    defineRoute({
      method: 'get',
      path: '/admin/escalations/:escalationId',
      access: ADMIN_ONLY,
      schemas: { params: escalationParamsSchema },
      handler: (ctx) => getEscalation(ctx.params.escalationId),
    }),
    defineRoute({
      method: 'patch',
      path: '/admin/escalations/:escalationId',
      access: ADMIN_ONLY,
      schemas: { params: escalationParamsSchema, body: escalationActionRequestSchema },
      handler: async (ctx) => {
        const row = await deps.escalations.transition(ctx.params.escalationId, ctx.body, {
          actorId: requireAuth(ctx).userId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          requestId: ctx.requestId,
        });
        return toDetail(row);
      },
    }),
  ];
}
