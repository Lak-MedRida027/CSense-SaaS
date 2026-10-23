import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // mongodb-memory-server downloads a mongod binary on first run.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
