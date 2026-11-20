/**
 * Maps authored content URLs to bundled media (ADR 0019, plan 5.2). Pure; used by the
 * `learning.getModule` handler so the renderer only ever receives `app://csense/media/<file>` or null.
 *
 * A content URL resolves only if it is https, on the configured media base (same origin, path under
 * the base path), carries no credentials, query or fragment, and its remainder is a manifest key.
 */
import { APP_ORIGIN } from '../security/policy';

export interface MediaEntry {
  file: string;
  type: string;
}

export interface MediaManifest {
  entries: ReadonlyMap<string, MediaEntry>;
}

export const MEDIA_URL_PREFIX = `${APP_ORIGIN}/media/`;

export function resolveMediaUrl(
  rawUrl: string | null | undefined,
  opts: { baseUrl: string; manifest: MediaManifest },
): string | null {
  if (!rawUrl) return null;
  let u: URL;
  let base: URL;
  try {
    u = new URL(rawUrl);
    base = new URL(opts.baseUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || base.protocol !== 'https:') return null;
  if (u.username !== '' || u.password !== '' || u.search !== '' || u.hash !== '') return null;
  if (u.origin !== base.origin) return null;
  // Reject encoded dots, separators and NUL before decoding: no traversal by encoding tricks.
  if (/%2e|%2f|%5c|%00/i.test(u.pathname)) return null;
  const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  if (!u.pathname.startsWith(basePath)) return null;
  let rest: string;
  try {
    rest = decodeURIComponent(u.pathname.slice(basePath.length));
  } catch {
    return null;
  }
  if (rest === '' || rest.includes('\\') || rest.split('/').some((s) => s === '..' || s === '.')) {
    return null;
  }
  const entry = opts.manifest.entries.get(rest);
  return entry ? `${MEDIA_URL_PREFIX}${entry.file}` : null;
}
