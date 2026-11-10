/**
 * Pure security policy decisions for the Electron shell (plan 4.1). No `electron` import: the glue in
 * `hardening.ts` and `protocol.ts` applies these decisions, and they are unit-tested directly.
 */
import { isAbsolute, resolve, sep } from 'node:path';

export const APP_SCHEME = 'app';
export const APP_HOST = 'csense';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/** Production CSP (plan 4.3). The renderer makes no network calls: `connect-src 'self'`. */
export const PRODUCTION_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** Flags that expose a debugger or alter the JS engine. A packaged build refuses to start with any. */
const FORBIDDEN_FLAG_PREFIXES = [
  '--remote-debugging-port',
  '--remote-debugging-pipe',
  '--inspect',
  '--inspect-brk',
  '--inspect-port',
  '--remote-allow-origins',
  '--js-flags',
  '--debug',
];

export function forbiddenCommandLineFlags(argv: readonly string[]): string[] {
  return argv.filter((arg) => {
    const flag = arg.split('=')[0]?.toLowerCase() ?? '';
    return FORBIDDEN_FLAG_PREFIXES.some((p) => flag === p || flag.startsWith(`${p}-`));
  });
}

export interface OriginContext {
  /** Dev-server origin (unpackaged only). */
  devOrigin?: string | null | undefined;
}

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.origin !== 'null') return u.origin;
    // Custom schemes report an opaque origin through URL in some runtimes; rebuild it.
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** The renderer may navigate only within its own origin (dev origin when unpackaged). */
export function isAllowedNavigation(url: string, ctx: OriginContext = {}): boolean {
  const o = originOf(url);
  if (o === null) return false;
  if (o === APP_ORIGIN) return true;
  return Boolean(ctx.devOrigin) && o === originOf(ctx.devOrigin ?? '');
}

/** The UI session's egress filter: anything that is not the app, devtools (dev) or the dev server. */
export function isAllowedEgress(
  url: string,
  ctx: OriginContext & { allowDevTools?: boolean } = {},
): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === `${APP_SCHEME}:`) return u.host === APP_HOST;
  if (u.protocol === 'devtools:') return Boolean(ctx.allowDevTools);
  if (ctx.devOrigin) {
    const dev = new URL(ctx.devOrigin);
    const wsProto = dev.protocol === 'https:' ? 'wss:' : 'ws:';
    if (u.host === dev.host && (u.protocol === dev.protocol || u.protocol === wsProto)) return true;
  }
  return false;
}

/** Only https URLs on an explicit host allowlist (empty by default) may reach `shell.openExternal`. */
export function isExternalLinkAllowed(url: string, allowedHosts: readonly string[]): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && allowedHosts.includes(u.hostname);
  } catch {
    return false;
  }
}

/** IPC sender check inputs (plan 4.4): top-level frame of the main window, on the app origin. */
export function isAllowedSender(args: {
  isMainFrame: boolean;
  isMainWindow: boolean;
  url: string;
  devOrigin?: string | null | undefined;
}): boolean {
  return args.isMainWindow && args.isMainFrame && isAllowedNavigation(args.url, args);
}

/**
 * Maps `app://csense/<path>` to a file inside `root`, or null. Rejects other hosts, encoded
 * separators, backslashes, NUL, `..` segments, drive letters and anything resolving outside `root`.
 */
export function resolveAppFile(rawUrl: string, root: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== `${APP_SCHEME}:` || u.host !== APP_HOST) return null;
  if (u.username !== '' || u.password !== '') return null;
  const rawPath = u.pathname;
  if (/%2f|%5c|%2e|%00/i.test(rawPath)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.includes(':')) return null;
  const segments = decoded.split('/').filter((s) => s !== '');
  if (segments.some((s) => s === '..' || s === '.')) return null;
  const rel = segments.length === 0 ? 'index.html' : segments.join('/');
  if (isAbsolute(rel)) return null;
  const rootAbs = resolve(root);
  const full = resolve(rootAbs, rel);
  return full.startsWith(rootAbs + sep) ? full : null;
}
