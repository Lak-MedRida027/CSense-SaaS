/**
 * The `/media/<file>` route of the `app://csense` protocol (ADR 0019). Only files named by the
 * manifest are served; the slice read from disk is bounded; nothing else of the file system is
 * reachable. Tested against a temp directory.
 */
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { APP_HOST, APP_SCHEME } from './policy';
import { MAX_MEDIA_RESPONSE_BYTES, parseByteRange } from './range';

export const MEDIA_PATH_PREFIX = '/media/';

/** `app://csense/media/<name>` to `<name>`, or null (other host, traversal, separators, encoding). */
export function mediaFileName(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== `${APP_SCHEME}:` || u.host !== APP_HOST) return null;
  if (u.username !== '' || u.password !== '') return null;
  if (!u.pathname.startsWith(MEDIA_PATH_PREFIX)) return null;
  const rest = u.pathname.slice(MEDIA_PATH_PREFIX.length);
  if (rest.includes('%') || rest.includes('\\') || rest.includes('/') || rest.includes('\0')) {
    return null;
  }
  return /^[a-z0-9-]+\.(webm|mp4|vtt)$/.test(rest) ? rest : null;
}

/** True for anything under `/media`, so a bad media URL is a 404 here and never reaches the bundle. */
export function isMediaRequest(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return (
      u.protocol === `${APP_SCHEME}:` &&
      u.host === APP_HOST &&
      (u.pathname === '/media' || u.pathname.startsWith(MEDIA_PATH_PREFIX))
    );
  } catch {
    return false;
  }
}

export interface MediaServeDeps {
  root: string;
  /** Manifest file name to MIME type. */
  files: ReadonlyMap<string, string>;
  baseHeaders: Record<string, string>;
}

async function readSlice(
  path: string,
  start: number,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const handle = await fsp.open(path, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buf, 0, length, start);
    return new Uint8Array(buf.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

export async function serveMedia(
  request: { url: string; method: string; headers: { get(name: string): string | null } },
  deps: MediaServeDeps,
): Promise<Response> {
  const h = deps.baseHeaders;
  const notFound = (): Response => new Response('Not found', { status: 404, headers: h });
  const name = mediaFileName(request.url);
  if (name === null) return notFound();
  const type = deps.files.get(name);
  if (type === undefined) return notFound();
  const path = join(deps.root, name);
  let size: number;
  try {
    size = (await fsp.stat(path)).size;
  } catch {
    return notFound();
  }
  const common = {
    ...h,
    'content-type': type.startsWith('text/') ? `${type}; charset=utf-8` : type,
    'accept-ranges': 'bytes',
  };
  const range = parseByteRange(request.headers.get('range'), size);
  if (range.kind === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { ...common, 'content-range': `bytes */${String(size)}` },
    });
  }
  const head = request.method === 'HEAD';
  try {
    if (range.kind === 'full' && size <= MAX_MEDIA_RESPONSE_BYTES) {
      const body = head ? null : await readSlice(path, 0, size);
      return new Response(body, {
        status: 200,
        headers: { ...common, 'content-length': String(size) },
      });
    }
    const start = range.kind === 'partial' ? range.start : 0;
    const wantedEnd = range.kind === 'partial' ? range.end : size - 1;
    const end = Math.min(wantedEnd, start + MAX_MEDIA_RESPONSE_BYTES - 1);
    const length = end - start + 1;
    const body = head ? null : await readSlice(path, start, length);
    return new Response(body, {
      status: 206,
      headers: {
        ...common,
        'content-range': `bytes ${String(start)}-${String(end)}/${String(size)}`,
        'content-length': String(length),
      },
    });
  } catch {
    return notFound();
  }
}
