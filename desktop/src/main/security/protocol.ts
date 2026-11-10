/**
 * The privileged `app://csense` scheme that serves the renderer bundle (plan 4.1, D5-20), replacing
 * `file://`. Path traversal is rejected by `resolveAppFile`; the CSP is also sent as a response header.
 */
import { promises as fs } from 'node:fs';
import { extname } from 'node:path';
import { protocol } from 'electron';
import { APP_SCHEME, PRODUCTION_CSP, resolveAppFile } from './policy';

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
};

/** Must run before `app` is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/** Must run after `app` is ready. */
export function handleAppProtocol(rendererRoot: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const headers = {
      'content-security-policy': PRODUCTION_CSP,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers });
    }
    const file = resolveAppFile(request.url, rendererRoot);
    if (file === null) return new Response('Not found', { status: 404, headers });
    try {
      const body = await fs.readFile(file);
      return new Response(request.method === 'HEAD' ? null : new Uint8Array(body), {
        status: 200,
        headers: {
          ...headers,
          'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        },
      });
    } catch {
      return new Response('Not found', { status: 404, headers });
    }
  });
}
