import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { healthRouter } from './features/health/health.routes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';

export interface AppOptions {
  logger: Logger;
  jsonBodyLimit: string;
  /** Override for readiness checks (tests). Defaults to the Mongoose connection state. */
  isReady?: () => boolean;
}

export function createApp({ logger, jsonBodyLimit, isReady }: AppOptions): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: jsonBodyLimit }));

  const api = express.Router();
  api.use(healthRouter(isReady));
  // Feature routers are mounted here from Phase 2 onwards (see docs/api/contract.md).
  app.use('/api/v1', api);

  app.use(notFound);
  app.use(errorHandler(logger));

  return app;
}
