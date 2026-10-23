import react from '@vitejs/plugin-react';
import { defineProject } from 'vitest/config';

export default defineProject({
  plugins: [react()],
  test: {
    name: 'desktop',
    environment: 'jsdom',
    include: ['src/renderer/src/**/*.test.tsx'],
  },
});
