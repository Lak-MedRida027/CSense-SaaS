import { loginRequestSchema, logoutRequestSchema, refreshRequestSchema } from '@csense/shared';
import {
  AUTHENTICATED,
  PUBLIC,
  defineRoute,
  requireAuth,
  type RouteContext,
  type RouteDef,
} from '../../http/routeRegistry.js';
import type { AuditContext } from '../audit/audit.service.js';
import { getCurrentUser, login, logout, refresh, type AuthDeps } from './auth.service.js';

const meta = (ctx: RouteContext): AuditContext => ({
  ip: ctx.ip,
  userAgent: ctx.userAgent,
  requestId: ctx.requestId,
});

/** Thin controllers: validation and access are declared here, logic lives in auth.service. */
export function authRoutes(deps: AuthDeps): RouteDef[] {
  return [
    defineRoute({
      method: 'post',
      path: '/auth/login',
      access: PUBLIC,
      limiter: 'login',
      schemas: { body: loginRequestSchema },
      handler: (ctx) => login(deps, ctx.body, meta(ctx)),
    }),
    defineRoute({
      method: 'post',
      path: '/auth/refresh',
      access: PUBLIC,
      limiter: 'refresh',
      schemas: { body: refreshRequestSchema },
      handler: (ctx) => refresh(deps, ctx.body.refreshToken, meta(ctx)),
    }),
    defineRoute({
      method: 'post',
      path: '/auth/logout',
      access: PUBLIC,
      schemas: { body: logoutRequestSchema },
      handler: async (ctx, _req, res) => {
        await logout(deps, ctx.body.refreshToken, meta(ctx));
        res.status(204).end();
      },
    }),
    defineRoute({
      method: 'get',
      path: '/auth/me',
      access: AUTHENTICATED,
      handler: (ctx) => getCurrentUser(requireAuth(ctx).userId),
    }),
  ];
}
