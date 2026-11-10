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
import { configureAudit, createAuditService } from './features/audit/audit.service.js';
import {
  createGamificationServices,
  type GamificationServices,
} from './features/gamification/services.js';
import type { SecurityTeamNotifier } from './features/governance/notifier.js';
import type { LearningHooks } from './features/learning/learningHooks.js';
import type { Shuffle } from './features/learning/shuffle.js';
import { allRoutes } from './routes.js';

/** How long a successful index check is trusted before it is repeated. */
const READINESS_CACHE_MS = 30_000;

/**
 * Connected, and every unique index the learning engine relies on exists with the right definition.
 * A positive index check is cached for a while so probes stay cheap; a failure is never cached, so
 * recovery shows immediately.
 */
function databaseReadiness(clock: () => Date): () => Promise<boolean> {
  let okUntil = 0;
  return async () => {
    if (!isDbConnected()) return false;
    if (clock().getTime() < okUntil) return true;
    try {
      const ok = (await missingLearningIndexes()).length === 0;
      if (ok) okUntil = clock().getTime() + READINESS_CACHE_MS;
      return ok;
    } catch {
      return false;
    }
  };
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
  /** Replaces the real XP, badge and risk hooks (tests inject spies). */
  learningHooks?: LearningHooks;
  /** The Phase 4 services; built from the config when omitted. */
  gamification?: GamificationServices;
  /** Receives escalation notices; defaults to a structured log line. */
  notifier?: SecurityTeamNotifier;
  /** Test seam for the question-order shuffle. */
  shuffle?: Shuffle;
}

export async function createApp({
  logger,
  config,
  isReady: isReadyOption,
  clock = () => new Date(),
  routes = [],
  timing,
  learningHooks,
  gamification: providedGamification,
  notifier,
  shuffle,
}: AppOptions): Promise<Express> {
  const isReady = isReadyOption ?? databaseReadiness(clock);
  const app = express();

  // Every audit write goes through this service (hash chain, ADR 0012).
  configureAudit(createAuditService({ chainSecret: config.audit.chainSecret, clock, logger }));
  const gamification =
    providedGamification ??
    createGamificationServices({ config, clock, logger, ...(notifier ? { notifier } : {}) });
  app.locals.gamification = gamification;

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
      gamification,
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
