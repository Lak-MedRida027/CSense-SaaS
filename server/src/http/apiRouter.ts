import { Router, type RequestHandler } from 'express';
import type { Limiters } from '../middleware/rateLimit.js';
import { notFoundError } from '../lib/httpError.js';
import { accessGate, ROUTER_OPTIONS, type Authenticate, type GateLocals } from './accessGate.js';
import { getRequestId } from './requestId.js';
import { assertRouteDefs, type RouteContext, type RouteDef } from './routeRegistry.js';
import { validateRequest } from './validate.js';

export interface ApiRouterDeps {
  authenticate: Authenticate;
  limiters: Limiters;
}

/**
 * The only code that registers handlers. The gate runs first on the router, so a route attached to
 * the returned router by any other means is unreachable (the gate answers 404 before it).
 */
export function buildApiRouter(defs: readonly RouteDef[], deps: ApiRouterDeps): Router {
  assertRouteDefs(defs);
  const router = Router(ROUTER_OPTIONS);
  router.use(accessGate(defs, deps.authenticate));

  for (const def of defs) {
    const limiters: RequestHandler[] = def.limiter ? deps.limiters[def.limiter] : [];
    router[def.method](def.path, ...limiters, (async (req, res, next) => {
      try {
        const locals = res.locals as GateLocals;
        // Fail closed if the gate and the router ever disagree about which route this is.
        if (locals.routeDef !== def) throw notFoundError();

        const { body, params, query } = validateRequest(def, req);
        const ctx: RouteContext = {
          body,
          params,
          query,
          auth: locals.auth ?? null,
          requestId: getRequestId(res),
          ip: req.ip ?? '',
          ...(req.get('user-agent') === undefined ? {} : { userAgent: req.get('user-agent') }),
        };
        const result = await def.handler(ctx, req, res);
        if (!res.headersSent && result !== undefined) res.json(result);
      } catch (err) {
        next(err);
      }
    }) satisfies RequestHandler);
  }
  return router;
}
