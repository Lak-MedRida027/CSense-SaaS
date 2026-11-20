import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_CONCURRENT_MEDIA_READS, activeMediaReads, serveMedia } from '../security/media';
import { MAX_MEDIA_RESPONSE_BYTES } from '../security/range';

describe('P6-I3: media status codes and read cap', () => {
  let dir: string;
  const files = new Map([
    ['big.webm', 'video/webm'],
    ['small.webm', 'video/webm'],
  ]);
  const big = MAX_MEDIA_RESPONSE_BYTES + 1024;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'csense-media-big-'));
    writeFileSync(join(dir, 'big.webm'), Buffer.alloc(big, 7));
    writeFileSync(join(dir, 'small.webm'), Buffer.alloc(2000, 1));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const get = (name: string, range?: string) =>
    serveMedia(
      {
        url: `app://csense/media/${name}`,
        method: 'GET',
        headers: { get: (n: string) => (n.toLowerCase() === 'range' ? (range ?? null) : null) },
      },
      { root: dir, files, baseHeaders: {} },
    );

  it('a file over the per-response cap without a Range header is 200 with the whole body', async () => {
    const res = await get('big.webm');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(big));
    expect((await res.arrayBuffer()).byteLength).toBe(big);
    await new Promise((r) => setTimeout(r, 50));
    expect(activeMediaReads()).toBe(0);
  });

  it('a Range request on the same file is still a bounded 206', async () => {
    const res = await get('big.webm', 'bytes=0-');
    expect(res.status).toBe(206);
    expect(Number(res.headers.get('content-length'))).toBe(MAX_MEDIA_RESPONSE_BYTES);
  });

  it('concurrent full reads are capped: the extra request gets 503 and the slot frees on completion', async () => {
    const open = await Promise.all(
      Array.from({ length: MAX_CONCURRENT_MEDIA_READS }, () => get('big.webm')),
    );
    expect(open.every((r) => r.status === 200)).toBe(true);
    expect(activeMediaReads()).toBe(MAX_CONCURRENT_MEDIA_READS);
    const extra = await get('small.webm');
    expect(extra.status).toBe(503);
    expect(extra.headers.get('retry-after')).toBe('1');
    for (const r of open) await r.arrayBuffer();
    await new Promise((r) => setTimeout(r, 100));
    expect(activeMediaReads()).toBe(0);
    expect((await get('small.webm')).status).toBe(200);
  });

  it('an abandoned stream releases its slot', async () => {
    const res = await get('big.webm');
    await res.body?.cancel();
    await new Promise((r) => setTimeout(r, 100));
    expect(activeMediaReads()).toBe(0);
  });
});
