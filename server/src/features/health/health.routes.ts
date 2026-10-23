import { Router } from 'express';
import type { HealthResponse, ReadinessResponse } from '@csense/shared';
import { isDbConnected } from '../../db/connect.js';

/** Liveness and readiness probes. Public, and deliberately reveal no internal detail. */
export function healthRouter(isReady: () => boolean = isDbConnected): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    const body: HealthResponse = { status: 'ok' };
    res.json(body);
  });

  router.get('/health/ready', (_req, res) => {
    const ready = isReady();
    const body: ReadinessResponse = { status: ready ? 'ready' : 'unavailable' };
    res.status(ready ? 200 : 503).json(body);
  });

  return router;
}
