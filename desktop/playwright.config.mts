import { defineConfig } from '@playwright/test';

/**
 * Electron end-to-end tests run against the built app (`npm run build` first, which also builds the
 * server dist the harness needs). `globalSetup` starts the test-only API (ADR 0018).
 */
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  globalSetup: './e2e/support/globalSetup.ts',
  globalTeardown: './e2e/support/globalTeardown.ts',
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'on-first-retry' },
});
