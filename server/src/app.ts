import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { AppConfig } from './config/appConfig.js';
import { isDbConnected } from './db/connect.js';
import { missingLearningIndexes } from './db/learningIndexes.js';
import { authenticateBearer } from './features/auth/auth.service.js';
import { FailedLoginFloor, realTiming, type Timing } from './features/auth/failedLoginDelay.js';
import { initDummyHash, verifyAgainstDummy } from './features/auth/password.js';
import { buildApiRouter } from './http/apiRouter.js';
import { getRequestId, requestId } from './http/requestId.js';
import type { RouteDef } from './http/routeRegistry.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { createLimiters } from './middleware/rateLimit.js';
import type { LearningHooks } from './features/learning/learningHooks.js';
import type { Shuffle } from './features/learning/shuffle.js';
import { allRoutes } from './routes.js';

/** Connected, and every unique index the learning engine relies on exists. */
async function isDatabaseReady(): Promise<boolean> {
  if (!isDbConnected()) return false;
  try {
    return (await missingLearningIndexes()).length === 0;
  } catch {
    return false;
  }
}

export interface AppOptions {
  logger: Logger;
  config: AppConfig;
  /** Override for readiness checks (tests). Defaults to the Mongoose connection state. */
  isReady?: () => boolean | Promise<boolean>;
  /** Injectable clock so expiry tests need no fake timers. */
  clock?: () => Date;
  /** Extra route definitions appended to the real table (tests). They get the same checks. */
  routes?: RouteDef[];
  /** Test seam for the failed-login response-time floor. */
  timing?: Timing;
  /** Learning seam for Phase 4 (XP, badges, risk). Defaults to no-ops. */
  learningHooks?: LearningHooks;
  /** Test seam for the question-order shuffle. */
  shuffle?: Shuffle;
}

export async function createApp({
  logger,
  config,
  isReady = isDatabaseReady,
  clock = () => new Date(),
  routes = [],
  timing,
  learningHooks,
  shuffle,
}: AppOptions): Promise<Express> {
  const app = express();

  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  if (config.trustProxyHops > 0) app.set('trust proxy', config.trustProxyHops);

  app.use(helmet());
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) => getRequestId(res as express.Response),
    }),
  );
  app.use(express.json({ limit: config.jsonBodyLimit }));

  const limiters = createLimiters(config.rateLimit, {
    onBackgroundError: (err) => {
      logger.error({ err }, 'Background audit write failed');
    },
  });
  const floor = new FailedLoginFloor(config.failedLoginMinMs);
  const defs = [
    ...allRoutes({
      config,
      clock,
      isReady,
      floor,
      onCredentialsFailure: limiters.onCredentialsFailure,
      logger,
      ...(timing ? { timing } : {}),
      ...(learningHooks ? { learningHooks } : {}),
      ...(shuffle ? { shuffle } : {}),
    }),
    ...routes,
  ];
  // Validates the route table first, so an unannotated route stops the server from starting.
  const api = buildApiRouter(defs, {
    limiters,
    authenticate: (header) => authenticateBearer({ config, clock }, header),
  });
  await initDummyHash(config.bcryptCost);
  if (config.failedLoginMinMs > 0) {
    const effectiveMs = await floor.calibrate(timing ?? realTiming, () =>
      verifyAgainstDummy('calibration-probe'),
    );
    logger.info(
      { configuredMs: config.failedLoginMinMs, effectiveMs },
      'Failed-login response floor calibrated',
    );
  }

  app.use('/api/v1', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/v1', limiters.global);
  app.use('/api/v1', api);

  app.use(notFound);
  app.use(errorHandler(logger));

  return app;
}
