import { defineConfig } from '@playwright/test';

/** Electron end-to-end tests run against the built app (`npm run build` first). */
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'on-first-retry' },
});
