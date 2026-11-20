// Fails the production build if the e2e harness was emitted into dist (P6-I2, ADR 0018).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(import.meta.dirname, '../dist/src/testing');
if (existsSync(dir)) {
  console.error(
    `Production build contains the e2e harness (${dir}). Remove it; build:e2e writes to dist-e2e.`,
  );
  process.exit(1);
}
