import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordingLogger } from '../testing/fakes';
import { isMediaRequest, mediaFileName, serveMedia } from '../security/media';
import { PRODUCTION_CSP } from '../security/policy';
import { parseByteRange } from '../security/range';
import { loadManifest, parseManifest, servableFiles } from './manifest';
import { resolveMediaUrl, type MediaManifest } from './mediaResolver';

const BASE = 'https://media.example.com/csense/';
const manifest: MediaManifest = {
  entries: new Map([
    ['placeholder/m1.mp4', { file: 'placeholder-lesson.webm', type: 'video/webm' }],
    ['placeholder/m1.vtt', { file: 'm1.vtt', type: 'text/vtt' }],
  ]),
};
const r = (u: string | null) => resolveMediaUrl(u, { baseUrl: BASE, manifest });

describe('MR1-MR8: resolveMediaUrl', () => {
  it('MR1 a manifest hit becomes an app://csense/media URL', () => {
    expect(r(`${BASE}placeholder/m1.mp4`)).toBe('app://csense/media/placeholder-lesson.webm');
    expect(r(`${BASE}placeholder/m1.vtt`)).toBe('app://csense/media/m1.vtt');
  });
  it('MR2 http, other origins and other schemes are refused', () => {
    expect(r('http://media.example.com/csense/placeholder/m1.mp4')).toBeNull();
    expect(r('https://evil.example.com/csense/placeholder/m1.mp4')).toBeNull();
    expect(r('https://media.example.com.evil.io/csense/placeholder/m1.mp4')).toBeNull();
    expect(r('javascript:alert(1)')).toBeNull();
    expect(r('app://csense/media/m1.vtt')).toBeNull();
  });
  it('MR3 paths outside the base are refused, including encoded traversal', () => {
    expect(r('https://media.example.com/other/placeholder/m1.mp4')).toBeNull();
    expect(r(`${BASE}../other/placeholder/m1.mp4`)).toBeNull();
    expect(r(`${BASE}%2e%2e/other/placeholder/m1.mp4`)).toBeNull();
    expect(r(`${BASE}placeholder%2fm1.mp4`)).toBeNull();
    expect(r(`${BASE}placeholder%5cm1.mp4`)).toBeNull();
    expect(r('https://media.example.com/csense-evil/placeholder/m1.mp4')).toBeNull();
  });
  it('MR4-MR6 credentials, query and fragment are refused', () => {
    expect(r('https://u:p@media.example.com/csense/placeholder/m1.mp4')).toBeNull();
    expect(r(`${BASE}placeholder/m1.mp4?x=1`)).toBeNull();
    expect(r(`${BASE}placeholder/m1.mp4#t=5`)).toBeNull();
  });
  it('MR7 unknown keys and empty input resolve to null', () => {
    expect(r(`${BASE}placeholder/m2.mp4`)).toBeNull();
    expect(r(BASE)).toBeNull();
    expect(r('')).toBeNull();
    expect(r(null)).toBeNull();
    expect(r('not a url')).toBeNull();
  });
  it('MR8 the output never contains the original URL', () => {
    expect(r(`${BASE}placeholder/m1.mp4`)).not.toContain('example.com');
  });
});

describe('RG: parseByteRange', () => {
  it('no header is a full response', () => {
    expect(parseByteRange(null, 100)).toEqual({ kind: 'full' });
    expect(parseByteRange('', 100)).toEqual({ kind: 'full' });
  });
  it('closed, open-ended and suffix ranges', () => {
    expect(parseByteRange('bytes=0-99', 1000)).toEqual({ kind: 'partial', start: 0, end: 99 });
    expect(parseByteRange('bytes=10-', 100)).toEqual({ kind: 'partial', start: 10, end: 99 });
    expect(parseByteRange('bytes=-10', 100)).toEqual({ kind: 'partial', start: 90, end: 99 });
    expect(parseByteRange('bytes=-500', 100)).toEqual({ kind: 'partial', start: 0, end: 99 });
    expect(parseByteRange('bytes=0-9999', 100)).toEqual({ kind: 'partial', start: 0, end: 99 });
  });
  it('unsatisfiable, multi-range and malformed input', () => {
    for (const h of [
      'bytes=100-',
      'bytes=200-300',
      'bytes=5-2',
      'bytes=0-1,5-6',
      'bytes=-',
      'bytes=-0',
      'items=0-1',
      'bytes=a-b',
      'bytes=0-1;x',
      `bytes=${'9'.repeat(40)}-`,
    ]) {
      expect(parseByteRange(h, 100), h).toEqual({ kind: 'unsatisfiable' });
    }
    expect(parseByteRange('bytes=0-1', 0)).toEqual({ kind: 'unsatisfiable' });
  });
});

describe('MF: manifest loader', () => {
  const fsOf = (files: Record<string, string>) => ({
    readFile: (p: string) => {
      const v = files[p.replace(/\\/g, '/')];
      return v === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(v);
    },
    exists: (p: string) => Promise.resolve(p.replace(/\\/g, '/') in files),
  });
  const good = JSON.stringify({
    v: 1,
    entries: { 'placeholder/m1.mp4': { file: 'clip.webm', type: 'video/webm' } },
  });

  it('MF1 a valid manifest loads', async () => {
    const m = await loadManifest(
      '/m',
      fsOf({ '/m/manifest.json': good, '/m/clip.webm': 'x' }),
      recordingLogger(),
    );
    expect([...m.entries.keys()]).toEqual(['placeholder/m1.mp4']);
    expect(servableFiles(m).get('clip.webm')).toBe('video/webm');
  });
  it('MF2 an invalid file name, type or key disables media and logs', async () => {
    for (const bad of [
      { v: 1, entries: { a: { file: '../x.webm', type: 'video/webm' } } },
      { v: 1, entries: { a: { file: 'x.exe', type: 'video/webm' } } },
      { v: 1, entries: { a: { file: 'x.webm', type: 'text/html' } } },
      { v: 1, entries: { '../a': { file: 'x.webm', type: 'video/webm' } } },
      { v: 1, entries: { 'a//b': { file: 'x.webm', type: 'video/webm' } } },
      { v: 2, entries: {} },
      { v: 1, entries: {}, extra: 1 },
    ]) {
      expect(parseManifest(bad)).toBeNull();
    }
    const log = recordingLogger();
    const m = await loadManifest('/m', fsOf({ '/m/manifest.json': '{bad json' }), log);
    expect(m.entries.size).toBe(0);
    expect(log.events.some((e) => e.event.startsWith('media.manifest'))).toBe(true);
  });
  it('MF3 an entry whose file is missing is dropped', async () => {
    const log = recordingLogger();
    const m = await loadManifest('/m', fsOf({ '/m/manifest.json': good }), log);
    expect(m.entries.size).toBe(0);
    expect(log.events.some((e) => e.event === 'media.file_missing')).toBe(true);
  });
});

describe('RG1-RG8: media route', () => {
  let dir: string;
  const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
  const baseHeaders = { 'x-test': '1' };
  const files = new Map([
    ['clip.webm', 'video/webm'],
    ['caps.vtt', 'text/vtt'],
  ]);

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'csense-media-'));
    writeFileSync(join(dir, 'clip.webm'), bytes);
    writeFileSync(join(dir, 'caps.vtt'), 'WEBVTT\n');
    writeFileSync(join(dir, 'secret.webm'), 'not in the manifest');
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const get = (url: string, range?: string, method = 'GET') =>
    serveMedia(
      {
        url,
        method,
        headers: { get: (n: string) => (n.toLowerCase() === 'range' ? (range ?? null) : null) },
      },
      { root: dir, files, baseHeaders },
    );
  const u = (f: string) => `app://csense/media/${f}`;

  it('RG1 no Range header is a 200 with the full body, MIME and Accept-Ranges', async () => {
    const res = await get(u('clip.webm'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('video/webm');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-length')).toBe('1000');
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
  });
  it('RG2 bytes=0-99 is a 206 with Content-Range and exactly that slice', async () => {
    const res = await get(u('clip.webm'), 'bytes=0-99');
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-99/1000');
    expect(res.headers.get('content-length')).toBe('100');
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes.subarray(0, 100))).toBe(true);
  });
  it('RG3 open-ended and suffix ranges', async () => {
    const a = await get(u('clip.webm'), 'bytes=990-');
    expect(a.headers.get('content-range')).toBe('bytes 990-999/1000');
    expect(Buffer.from(await a.arrayBuffer()).equals(bytes.subarray(990))).toBe(true);
    const b = await get(u('clip.webm'), 'bytes=-5');
    expect(b.headers.get('content-range')).toBe('bytes 995-999/1000');
  });
  it('RG4 out-of-range and multi-range requests are 416 with bytes */size', async () => {
    for (const h of ['bytes=1000-', 'bytes=0-1,5-6', 'garbage']) {
      const res = await get(u('clip.webm'), h);
      expect(res.status, h).toBe(416);
      expect(res.headers.get('content-range')).toBe('bytes */1000');
    }
  });
  it('RG5 a file outside the manifest is 404 even if it exists on disk', async () => {
    expect((await get(u('secret.webm'))).status).toBe(404);
    expect((await get(u('missing.webm'))).status).toBe(404);
  });
  it('RG6 traversal, encodings, nested paths and other hosts are 404', async () => {
    for (const url of [
      'app://csense/media/../clip.webm',
      'app://csense/media/%2e%2e/clip.webm',
      'app://csense/media/..%2fclip.webm',
      'app://csense/media/sub/clip.webm',
      'app://csense/media/clip%2ewebm',
      'app://csense/media/clip.webm%00.png',
      'app://csense/media/',
      'app://other/media/clip.webm',
      'app://csense/media/C:/Windows/win.ini',
    ]) {
      expect((await get(url)).status, url).toBe(404);
    }
  });
  it('RG7 HEAD returns headers and no body', async () => {
    const res = await get(u('clip.webm'), undefined, 'HEAD');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('1000');
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });
  it('RG8 MIME per manifest, VTT gets a charset, base headers are kept', async () => {
    const res = await get(u('caps.vtt'));
    expect(res.headers.get('content-type')).toBe('text/vtt; charset=utf-8');
    expect(res.headers.get('x-test')).toBe('1');
  });
  it('isMediaRequest routes everything under /media away from the bundle', () => {
    expect(isMediaRequest('app://csense/media/x')).toBe(true);
    expect(isMediaRequest('app://csense/media')).toBe(true);
    expect(isMediaRequest('app://csense/index.html')).toBe(false);
    expect(mediaFileName('app://csense/media/clip.webm')).toBe('clip.webm');
  });
});

describe('CSP1: media-src', () => {
  it('production allows self only, with no remote host', () => {
    expect(PRODUCTION_CSP).toContain("media-src 'self';");
    expect(PRODUCTION_CSP).not.toMatch(/media-src[^;]*(https?:|\*|app:)/);
  });
});
