/**
 * The `/media/<file>` route of the `app://csense` protocol (ADR 0019). Only files named by the
 * manifest are served; the slice read from disk is bounded; nothing else of the file system is
 * reachable. Tested against a temp directory.
 */
import { createReadStream, promises as fsp } from 'node:fs';
import { Readable } from 'node:stream';
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

/** At most this many media reads at once; further requests get 503 and the player retries (P6-I3). */
export const MAX_CONCURRENT_MEDIA_READS = 4;
let activeReads = 0;

/** Test hook. */
export function activeMediaReads(): number {
  return activeReads;
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
  if (!head && activeReads >= MAX_CONCURRENT_MEDIA_READS) {
    return new Response('Busy', { status: 503, headers: { ...h, 'retry-after': '1' } });
  }
  activeReads++;
  let released = false;
  const release = (): void => {
    if (!released) {
      released = true;
      activeReads--;
    }
  };
  try {
    if (head) release();
    if (range.kind === 'full') {
      // No Range header: 200 with the whole file, streamed so memory stays flat (P6-I3).
      if (head)
        return new Response(null, {
          status: 200,
          headers: { ...common, 'content-length': String(size) },
        });
      const node = createReadStream(path);
      node.once('close', release);
      node.once('error', release);
      const web = Readable.toWeb(node) as unknown as ReadableStream<Uint8Array>;
      return new Response(web, {
        status: 200,
        headers: { ...common, 'content-length': String(size) },
      });
    }
    const start = range.start;
    const end = Math.min(range.end, start + MAX_MEDIA_RESPONSE_BYTES - 1);
    const length = end - start + 1;
    const body = head ? null : await readSlice(path, start, length);
    release();
    return new Response(body, {
      status: 206,
      headers: {
        ...common,
        'content-range': `bytes ${String(start)}-${String(end)}/${String(size)}`,
        'content-length': String(length),
      },
    });
  } catch {
    release();
    return notFound();
  }
}
