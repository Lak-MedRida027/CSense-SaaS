import { createUserRequestSchema } from '@csense/shared';
import { ADMIN_ONLY, defineRoute, requireAuth, type RouteDef } from '../../http/routeRegistry.js';
import { createUser } from './users.service.js';

export function usersRoutes(deps: { bcryptCost: number }): RouteDef[] {
  return [
    defineRoute({
      method: 'post',
      path: '/admin/users',
      access: ADMIN_ONLY,
      schemas: { body: createUserRequestSchema },
      handler: async (ctx, _req, res) => {
        const user = await createUser(deps, requireAuth(ctx), ctx.body, {
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          requestId: ctx.requestId,
        });
        res.status(201).json(user);
      },
    }),
  ];
}
