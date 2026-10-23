import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { connectDb, disconnectDb } from './db/connect.js';
import { createLogger } from './lib/logger.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);

  await connectDb(env.MONGODB_URI);
  logger.info('Connected to MongoDB');

  const app = createApp({ logger, jsonBodyLimit: env.JSON_BODY_LIMIT });
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
