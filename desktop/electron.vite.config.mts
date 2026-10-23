import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

const here = import.meta.dirname;
const pkg = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8')) as {
  version: string;
};
const sharedSrc = resolve(here, '../shared/src/index.ts');
const alias = { '@csense/shared': sharedSrc };

// Only MAIN_VITE_* / RENDERER_VITE_* variables from the root .env reach these bundles.
const envDir = resolve(here, '..');

export default defineConfig({
  main: {
    envDir,
    resolve: { alias },
  },
  preload: {
    resolve: { alias },
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  },
  renderer: {
    envDir,
    resolve: { alias },
    plugins: [react()],
  },
});
