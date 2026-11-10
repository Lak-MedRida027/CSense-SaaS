import { describe, expect, it } from 'vitest';
import { loadDesktopConfig, validateApiBaseUrl } from './config';

const load = (
  build: Record<string, string | undefined>,
  env: Record<string, string | undefined>,
  isPackaged: boolean,
) => loadDesktopConfig({ build, env }, { isPackaged });

describe('CFG1-CFG4: API URL policy matrix', () => {
  const cases: { url: string; packaged: boolean; ok: boolean; why: string }[] = [
    {
      url: 'https://api.example.com/api/v1',
      packaged: true,
      ok: true,
      why: 'https public, packaged',
    },
    { url: 'https://api.example.com/api/v1', packaged: false, ok: true, why: 'https public, dev' },
    {
      url: 'https://localhost:4000/api/v1',
      packaged: true,
      ok: true,
      why: 'https loopback, packaged',
    },
    { url: 'http://localhost:4000/api/v1', packaged: false, ok: true, why: 'http localhost, dev' },
    { url: 'http://127.0.0.1:4000/api/v1', packaged: false, ok: true, why: 'http 127.0.0.1, dev' },
    { url: 'http://[::1]:4000/api/v1', packaged: false, ok: true, why: 'http ::1, dev' },
    {
      url: 'http://localhost:4000/api/v1',
      packaged: true,
      ok: false,
      why: 'http localhost, packaged',
    },
    {
      url: 'http://127.0.0.1:4000/api/v1',
      packaged: true,
      ok: false,
      why: 'http loopback, packaged',
    },
    { url: 'http://192.168.1.20:4000/api/v1', packaged: false, ok: false, why: 'http LAN, dev' },
    { url: 'http://10.0.0.5/api/v1', packaged: false, ok: false, why: 'http LAN 10/8, dev' },
    { url: 'http://example.com/api/v1', packaged: false, ok: false, why: 'http public, dev' },
    { url: 'http://localhost.evil.com/api/v1', packaged: false, ok: false, why: 'lookalike host' },
    { url: 'http://localhost@evil.com/api/v1', packaged: false, ok: false, why: 'userinfo trick' },
    { url: 'ftp://localhost/api/v1', packaged: false, ok: false, why: 'wrong scheme' },
    { url: 'javascript:alert(1)', packaged: false, ok: false, why: 'javascript scheme' },
  ];
  for (const c of cases) {
    it(`${c.ok ? 'accepts' : 'refuses'}: ${c.why}`, () => {
      expect(validateApiBaseUrl(c.url, c.packaged).ok).toBe(c.ok);
    });
  }

  it('CFG5 refuses credentials, query, fragment and a wrong path', () => {
    for (const url of [
      'https://user:pw@api.example.com/api/v1',
      'https://user@api.example.com/api/v1',
      'https://api.example.com/api/v1?x=1',
      'https://api.example.com/api/v1#frag',
      'https://api.example.com/',
      'https://api.example.com/api/v2',
      'https://api.example.com/api/v1/extra',
    ]) {
      expect(validateApiBaseUrl(url, true).ok, url).toBe(false);
    }
  });

  it('normalises a trailing slash and keeps a path prefix', () => {
    expect(validateApiBaseUrl('https://api.example.com/api/v1/', true)).toEqual({
      ok: true,
      url: 'https://api.example.com/api/v1',
    });
    expect(validateApiBaseUrl('https://example.com/csense/api/v1', true)).toEqual({
      ok: true,
      url: 'https://example.com/csense/api/v1',
    });
  });

  it('refuses a missing or empty URL', () => {
    expect(validateApiBaseUrl(undefined, true).ok).toBe(false);
    expect(validateApiBaseUrl('  ', false).ok).toBe(false);
  });
});

describe('CFG6: runtime CSENSE_* overrides', () => {
  const build = { MAIN_VITE_API_BASE_URL: 'https://prod.example.com/api/v1' };

  it('are honoured when unpackaged', () => {
    const c = load(
      build,
      {
        CSENSE_API_BASE_URL: 'http://127.0.0.1:5555/api/v1',
        CSENSE_USER_DATA_DIR: '/tmp/ud',
        CSENSE_GATE_POLL_SECONDS: '2',
        CSENSE_DEVTOOLS: '0',
      },
      false,
    );
    expect(c.apiBaseUrl).toBe('http://127.0.0.1:5555/api/v1');
    expect(c.userDataDir).toBe('/tmp/ud');
    expect(c.gateRestrictedPollSeconds).toBe(2);
    expect(c.devToolsInDev).toBe(false);
  });

  it('every one of them is ignored when packaged', () => {
    const c = load(
      { ...build, MAIN_VITE_AUTOSTART: 'true' },
      {
        CSENSE_API_BASE_URL: 'http://127.0.0.1:5555/api/v1',
        CSENSE_USER_DATA_DIR: '/tmp/ud',
        CSENSE_GATE_POLL_SECONDS: '2',
        CSENSE_DEVTOOLS: '1',
      },
      true,
    );
    expect(c.apiBaseUrl).toBe('https://prod.example.com/api/v1');
    expect(c.userDataDir).toBeNull();
    expect(c.gateRestrictedPollSeconds).toBe(60);
    expect(c.devToolsInDev).toBe(false);
    expect(c.autoStart).toBe(true);
  });

  it('a packaged build with only an http override is misconfigured, not relaxed', () => {
    const c = load({}, { CSENSE_API_BASE_URL: 'http://localhost:4000/api/v1' }, true);
    expect(c.apiBaseUrl).toBeNull();
    expect(c.configError).toBeTruthy();
  });

  it('auto-start is never active when unpackaged', () => {
    expect(load({ ...build, MAIN_VITE_AUTOSTART: 'true' }, {}, false).autoStart).toBe(false);
  });
});

describe('CFG7-CFG8: numeric bounds and defaults', () => {
  const ok = { MAIN_VITE_API_BASE_URL: 'https://a.example.com/api/v1' };

  it('uses the documented defaults', () => {
    const c = load(ok, {}, true);
    expect(c).toMatchObject({
      gateOfflinePolicy: 'open_after_grace',
      gateOfflineGraceSeconds: 120,
      gateRestrictedPollSeconds: 60,
      lockdownMaxFocusLosses: 3,
      lockdownFocusAwaySeconds: 15,
      reminders: { firstDelayMinutes: 120, intervalMinutes: 240, maxPerDay: 2 },
      autoStart: true,
      externalLinkHosts: [],
    });
  });

  it('falls back to the default for out-of-range or malformed values', () => {
    const c = load(
      {
        ...ok,
        MAIN_VITE_GATE_OFFLINE_GRACE_SECONDS: '5',
        MAIN_VITE_LOCKDOWN_MAX_FOCUS_LOSSES: '0',
        MAIN_VITE_LOCKDOWN_FOCUS_AWAY_SECONDS: '9999',
        MAIN_VITE_REMINDER_MAX_PER_DAY: 'many',
      },
      {},
      true,
    );
    expect(c.gateOfflineGraceSeconds).toBe(120);
    expect(c.lockdownMaxFocusLosses).toBe(3);
    expect(c.lockdownFocusAwaySeconds).toBe(15);
    expect(c.reminders.maxPerDay).toBe(2);
  });

  it('accepts in-range values and the closed offline policy', () => {
    const c = load(
      {
        ...ok,
        MAIN_VITE_GATE_OFFLINE_POLICY: 'closed',
        MAIN_VITE_GATE_OFFLINE_GRACE_SECONDS: '30',
        MAIN_VITE_LOCKDOWN_MAX_FOCUS_LOSSES: '10',
        MAIN_VITE_LOCKDOWN_FOCUS_AWAY_SECONDS: '5',
      },
      {},
      true,
    );
    expect(c).toMatchObject({
      gateOfflinePolicy: 'closed',
      gateOfflineGraceSeconds: 30,
      lockdownMaxFocusLosses: 10,
      lockdownFocusAwaySeconds: 5,
    });
  });

  it('an unknown offline policy falls back to the default, never to something looser', () => {
    expect(
      load({ ...ok, MAIN_VITE_GATE_OFFLINE_POLICY: 'always_open' }, {}, true).gateOfflinePolicy,
    ).toBe('open_after_grace');
  });

  it('poll interval override is bounded to 2..600', () => {
    expect(load(ok, { CSENSE_GATE_POLL_SECONDS: '1' }, false).gateRestrictedPollSeconds).toBe(60);
    expect(load(ok, { CSENSE_GATE_POLL_SECONDS: '601' }, false).gateRestrictedPollSeconds).toBe(60);
    expect(load(ok, { CSENSE_GATE_POLL_SECONDS: '600' }, false).gateRestrictedPollSeconds).toBe(
      600,
    );
  });
});
