import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_CSP,
  forbiddenCommandLineFlags,
  isAllowedEgress,
  isAllowedNavigation,
  isAllowedSender,
  isExternalLinkAllowed,
  resolveAppFile,
} from './policy';

describe('S3: navigation and egress', () => {
  it('only the app origin (and the dev origin when given) may be navigated to', () => {
    expect(isAllowedNavigation('app://csense/index.html')).toBe(true);
    expect(isAllowedNavigation('app://csense/#/preview')).toBe(true);
    for (const u of [
      'https://example.com/',
      'file:///C:/Windows/win.ini',
      'app://evil/index.html',
      'http://localhost:5173/',
      'javascript:alert(1)',
      'data:text/html,hi',
      'not a url',
    ]) {
      expect(isAllowedNavigation(u), u).toBe(false);
    }
    expect(
      isAllowedNavigation('http://localhost:5173/x', { devOrigin: 'http://localhost:5173' }),
    ).toBe(true);
    expect(
      isAllowedNavigation('http://localhost:9999/x', { devOrigin: 'http://localhost:5173' }),
    ).toBe(false);
  });

  it('S4: the egress filter allows only the app, devtools (dev) and the dev server', () => {
    expect(isAllowedEgress('app://csense/assets/index.js')).toBe(true);
    expect(isAllowedEgress('app://csense/cover.html')).toBe(true);
    expect(isAllowedEgress('app://other/x')).toBe(false);
    expect(isAllowedEgress('https://api.example.com/api/v1/gate/status')).toBe(false);
    expect(isAllowedEgress('http://localhost:4000/api/v1/modules')).toBe(false);
    expect(isAllowedEgress('file:///etc/passwd')).toBe(false);
    expect(isAllowedEgress('ws://localhost:5173/')).toBe(false);
    expect(isAllowedEgress('devtools://devtools/bundled/x.js')).toBe(false);
    expect(isAllowedEgress('devtools://devtools/bundled/x.js', { allowDevTools: true })).toBe(true);
    const dev = { devOrigin: 'http://localhost:5173' };
    expect(isAllowedEgress('http://localhost:5173/src/main.tsx', dev)).toBe(true);
    expect(isAllowedEgress('ws://localhost:5173/', dev)).toBe(true);
    expect(isAllowedEgress('http://localhost:4000/api', dev)).toBe(false);
  });

  it('external links need an https URL on the (empty by default) allowlist', () => {
    expect(isExternalLinkAllowed('https://example.com', [])).toBe(false);
    expect(isExternalLinkAllowed('https://help.example.com/x', ['help.example.com'])).toBe(true);
    expect(isExternalLinkAllowed('http://help.example.com/x', ['help.example.com'])).toBe(false);
    expect(isExternalLinkAllowed('https://evil.com/help.example.com', ['help.example.com'])).toBe(
      false,
    );
  });
});

describe('S6: IPC sender', () => {
  const base = { isMainFrame: true, isMainWindow: true, url: 'app://csense/index.html' };
  it('accepts the main window top frame on the app origin only', () => {
    expect(isAllowedSender(base)).toBe(true);
    expect(isAllowedSender({ ...base, isMainFrame: false })).toBe(false);
    expect(isAllowedSender({ ...base, isMainWindow: false })).toBe(false);
    expect(isAllowedSender({ ...base, url: 'https://evil.example/' })).toBe(false);
    expect(isAllowedSender({ ...base, url: '' })).toBe(false);
    expect(isAllowedSender({ ...base, url: 'file:///x.html' })).toBe(false);
  });
});

describe('S2: command-line guard', () => {
  it('flags every debugging switch, with or without a value', () => {
    expect(forbiddenCommandLineFlags(['app.exe', '--autostart'])).toEqual([]);
    for (const flag of [
      '--remote-debugging-port=9222',
      '--remote-debugging-pipe',
      '--inspect',
      '--inspect=0',
      '--inspect-brk=9229',
      '--remote-allow-origins=*',
      '--js-flags=--expose-gc',
      '--REMOTE-DEBUGGING-PORT=1',
    ]) {
      expect(forbiddenCommandLineFlags(['app.exe', flag]), flag).toEqual([flag]);
    }
  });
});

describe('app:// path resolution', () => {
  const root = resolve('/srv/renderer');
  it('maps files and the index', () => {
    expect(resolveAppFile('app://csense/', root)).toBe(resolve(root, 'index.html'));
    expect(resolveAppFile('app://csense/index.html', root)).toBe(resolve(root, 'index.html'));
    expect(resolveAppFile('app://csense/assets/a.js?v=1', root)).toBe(resolve(root, 'assets/a.js'));
  });

  it('rejects traversal, encoded separators, backslashes, drive letters, NUL and foreign hosts', () => {
    for (const u of [
      'app://csense/%2E%2E%2Fsecret',
      'app://csense/assets%2f..%2fsecret',
      'app://csense/assets%5c..%5csecret',
      'app://csense/assets\\..\\secret',
      'app://csense/C:/Windows/win.ini',
      'app://csense/%00',
      'app://evil/index.html',
      'https://csense/index.html',
      'app://user:pw@csense/index.html',
      'not a url',
    ]) {
      expect(resolveAppFile(u, root), u).toBeNull();
    }
  });
});

describe('app:// dot segments', () => {
  it('are normalised by URL parsing and can never resolve outside the root', () => {
    const root = resolve('/srv/renderer');
    for (const u of [
      'app://csense/../secret',
      'app://csense/assets/../../secret',
      'app://csense/%2e%2e/secret',
    ]) {
      const r = resolveAppFile(u, root);
      expect(r === null || r.startsWith(root + sep), u).toBe(true);
    }
  });
});

describe('CSP', () => {
  it('matches the plan: no network from the renderer', () => {
    expect(PRODUCTION_CSP).toContain("default-src 'none'");
    expect(PRODUCTION_CSP).toContain("connect-src 'self'");
    expect(PRODUCTION_CSP).toContain("frame-ancestors 'none'");
    expect(PRODUCTION_CSP).not.toMatch(/localhost|ws:|unsafe-eval/);
  });

  it('the index.html meta carries the same policy (frame-ancestors is header-only)', () => {
    const html = readFileSync(resolve(import.meta.dirname, '../../renderer/index.html'), 'utf8');
    const meta = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1];
    const header = PRODUCTION_CSP.split('; ').filter((d) => !d.startsWith('frame-ancestors'));
    expect(meta?.split('; ')).toEqual(header);
  });
});
