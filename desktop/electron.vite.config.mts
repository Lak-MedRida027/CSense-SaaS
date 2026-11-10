import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

const here = import.meta.dirname;
const pkg = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8')) as {
  version: string;
};
const sharedSrc = resolve(here, '../shared/src/index.ts');
const alias = { '@csense/shared': sharedSrc };

// Only MAIN_VITE_* / RENDERER_VITE_* variables from the root .env reach these bundles.
const envDir = resolve(here, '..');

/**
 * Development-only CSP (plan 4.3): Vite HMR needs inline scripts for the React refresh preamble and
 * websockets to the dev origin. Applied by the dev server only; production bundles keep the strict
 * policy from index.html, which never contains `ws:`.
 */
const devCsp: Plugin = {
  name: 'csense-dev-csp',
  apply: 'serve',
  transformIndexHtml(html) {
    return html
      .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
      .replace("connect-src 'self'", "connect-src 'self' ws://localhost:* http://localhost:*");
  },
};

export default defineConfig({
  main: {
    envDir,
    resolve: { alias },
    // Bundle the workspace package: it is an ESM source package, not something to require at runtime.
    build: { externalizeDeps: { exclude: ['@csense/shared'] } },
  },
  preload: {
    resolve: { alias },
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  },
  renderer: {
    envDir,
    resolve: { alias },
    plugins: [react(), devCsp],
  },
});
