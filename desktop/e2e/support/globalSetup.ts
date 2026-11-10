import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { startBackend } from './backendProcess';

/**
 * Builds the test-only harness, then spawns the API once for the whole run (ADR 0018). The harness
 * is deliberately NOT part of `npm run build`, so the e2e path builds it itself.
 */
export default async function globalSetup(): Promise<void> {
  // The styleguide accessibility spec needs no API; do not pay for MongoDB there.
  if (process.argv.some((a) => a.includes('styleguide.a11y'))) return;
  const built = spawnSync('npm', ['run', 'build:e2e', '-w', '@csense/server'], {
    cwd: resolve(process.cwd(), '..'),
    stdio: 'inherit',
    shell: true,
  });
  if (built.status !== 0) throw new Error('npm run build:e2e -w @csense/server failed');
  await startBackend();
}
