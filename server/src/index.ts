import { createApp } from './app.js';
import { toAppConfig } from './config/appConfig.js';
import { loadEnv } from './config/env.js';
import { connectDb, disconnectDb } from './db/connect.js';
import { scrubBootstrapEnv } from './config/scrubEnv.js';
import { createLogger } from './lib/logger.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const scrubbed = scrubBootstrapEnv(process.env);
  if (scrubbed.length > 0) {
    logger.warn(
      { keys: scrubbed },
      'BOOTSTRAP_ADMIN_* variables were present in the API environment and were removed from the process; remove them from .env',
    );
  }

  await connectDb(env.MONGODB_URI);
  logger.info('Connected to MongoDB');

  const app = await createApp({ logger, config: toAppConfig(env) });
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'CSense API listening');
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => {
      void disconnectDb().finally(() => process.exit(0));
    });
  };
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
}

main().catch((err: unknown) => {
  // Logger may not exist yet (bad env), so write a plain message to stderr.
  process.stderr.write(
    `CSense API failed to start: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
