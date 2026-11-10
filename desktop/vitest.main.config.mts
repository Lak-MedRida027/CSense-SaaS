import { resolve } from 'node:path';
import { defineProject } from 'vitest/config';

/** Main-process unit tests: Electron is replaced by fakes behind the ports (ADR 0013 item 9). */
export default defineProject({
  resolve: { alias: { '@csense/shared': resolve(import.meta.dirname, '../shared/src/index.ts') } },
  test: {
    name: 'desktop-main',
    environment: 'node',
    include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts', 'build/**/*.test.ts'],
  },
});
