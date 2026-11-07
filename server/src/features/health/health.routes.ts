import type { HealthResponse, ReadinessResponse } from '@csense/shared';
import { PUBLIC, defineRoute, type RouteDef } from '../../http/routeRegistry.js';

/** Liveness and readiness probes. Public, and deliberately reveal no internal detail. */
export function healthRoutes(isReady: () => boolean | Promise<boolean>): RouteDef[] {
  return [
    defineRoute({
      method: 'get',
      path: '/health',
      access: PUBLIC,
      handler: (): HealthResponse => ({ status: 'ok' }),
    }),
    defineRoute({
      method: 'get',
      path: '/health/ready',
      access: PUBLIC,
      handler: async (_ctx, _req, res) => {
        const ready = await isReady();
        const body: ReadinessResponse = { status: ready ? 'ready' : 'unavailable' };
        res.status(ready ? 200 : 503).json(body);
      },
    }),
  ];
}
