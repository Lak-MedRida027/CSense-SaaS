import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['shared', 'server', 'desktop', 'desktop/vitest.main.config.mts'],
  },
});
