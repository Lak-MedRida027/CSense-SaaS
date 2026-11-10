import { startBackend } from './backendProcess';

/** Spawns the test-only API once for the whole run (ADR 0018). */
export default async function globalSetup(): Promise<void> {
  // The styleguide accessibility spec needs no API; do not pay for MongoDB there.
  if (process.argv.some((a) => a.includes('styleguide.a11y'))) return;
  await startBackend();
}
