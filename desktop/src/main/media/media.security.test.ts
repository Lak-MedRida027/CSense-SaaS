/** Security-tester probes for bundled media (plan 10, E8). */
import { describe, expect, it } from 'vitest';
import { mediaFileName } from '../security/media';
import { parseByteRange } from '../security/range';
import { parseManifest } from './manifest';
import { resolveMediaUrl, type MediaManifest } from './mediaResolver';

const manifest: MediaManifest = {
  entries: new Map([
    ['placeholder/m1.mp4', { file: 'placeholder-lesson.webm', type: 'video/webm' }],
  ]),
};
const baseUrl = 'https://media.example.com/csense/';
const r = (u: string) => resolveMediaUrl(u, { baseUrl, manifest });

describe('SEC6-M: media URL rewriting and protocol names', () => {
  it('resolver: lookalike hosts, ports, userinfo, schemes and encodings never resolve', () => {
    for (const u of [
      'https://media.example.com.evil.test/csense/placeholder/m1.mp4',
      'https://evil.test/https://media.example.com/csense/placeholder/m1.mp4',
      'https://media.example.com:8443/csense/placeholder/m1.mp4',
      'https://media.example.com@evil.test/csense/placeholder/m1.mp4',
      'http://media.example.com/csense/placeholder/m1.mp4',
      'file:///C:/csense/placeholder/m1.mp4',
      'javascript:alert(1)//https://media.example.com/csense/placeholder/m1.mp4',
      'https://media.example.com/csense-other/placeholder/m1.mp4',
      'https://media.example.com/csense/placeholder%2fm1.mp4',
      'https://media.example.com/csense/placeholder/m1%2Emp4',
      'https://media.example.com/csense/placeholder/m1.mp4%00',
      'https://media.example.com/csense/PLACEHOLDER/m1.mp4',
      'https://media.example.com/csense/placeholder/m1.mp4?x=1',
      'https://media.example.com/csense/placeholder/m1.mp4#t=1',
      'https://media.example.com/csense/%E0%A4%A',
      ' https://media.example.com/csense/placeholder/m1.mp4/..',
    ]) {
      expect(r(u), u).toBeNull();
    }
    // Normalised forms of the real key are fine (same file): no escape is possible.
    for (const u of [
      'https://MEDIA.example.com:443/csense/placeholder/m1.mp4',
      // WHATWG URL turns a backslash into a slash for https: same allowlisted key, benign.
      'https://media.example.com/csense/placeholder\\m1.mp4',
    ]) {
      expect(r(u), u).toBe('app://csense/media/placeholder-lesson.webm');
    }
  });

  it('protocol names: only flat lowercase manifest-style names', () => {
    for (const u of [
      'app://csense/media/../index.html',
      'app://csense/media/%2e%2e/index.html',
      'app://csense/media/sub/x.webm',
      'app://csense/media/x.webm%00.html',
      'app://csense/media/X.WEBM',
      'app://csense/media/x.html',
      'app://csense/media/.webm',
      'app://csense/media/x.webm.',
      'app://csense/media/x.webm::$DATA',
      'app://csense/media/con.webm/',
      'app://other/media/x.webm',
      'app://user:pw@csense/media/x.webm',
    ]) {
      expect(mediaFileName(u), u).toBeNull();
    }
  });

  it('manifest: traversal keys, absolute files and odd types are refused', () => {
    const bad = [
      { v: 1, entries: { 'a/../b.mp4': { file: 'x.webm', type: 'video/webm' } } },
      { v: 1, entries: { 'a.mp4': { file: '../x.webm', type: 'video/webm' } } },
      { v: 1, entries: { 'a.mp4': { file: 'C:x.webm', type: 'video/webm' } } },
      { v: 1, entries: { 'a.mp4': { file: 'x.webm', type: 'text/html' } } },
      { v: 1, entries: { 'a.mp4': { file: 'x.html', type: 'video/webm' } } },
      { v: 1, entries: { 'a//b.mp4': { file: 'x.webm', type: 'video/webm' } } },
      { v: 1, entries: { 'a.mp4': { file: 'x.webm', type: 'video/webm', extra: 1 } } },
    ];
    for (const m of bad) expect(parseManifest(m), JSON.stringify(m)).toBeNull();
  });

  it('range: overflow, negatives, whitespace, multi-range and unicode digits never yield an out-of-file slice', () => {
    const size = 1000;
    const inFile = (x: ReturnType<typeof parseByteRange>) =>
      x.kind !== 'partial' || (x.start >= 0 && x.end < size && x.start <= x.end);
    for (const h of [
      'bytes=-1-5',
      'bytes=5--1',
      'bytes=999999999999999-',
      'bytes=0-999999999999999',
      'bytes=-999999999999999',
      'bytes=9999999999999999999999-',
      'bytes=1e3-',
      'bytes=0x10-0x20',
      'bytes=٠-٥',
      'bytes=0-1,2-3',
      'bytes = 0-1',
      'items=0-1',
      'bytes=0-1\r\nX: y',
      'bytes=NaN-',
      'bytes=-',
    ]) {
      const res = parseByteRange(h, size);
      expect(inFile(res), h).toBe(true);
    }
    expect(parseByteRange('bytes=-999999999999999', size)).toEqual({
      kind: 'partial',
      start: 0,
      end: 999,
    });
    expect(parseByteRange('bytes=0-1,2-3', size)).toEqual({ kind: 'unsatisfiable' });
  });
});
