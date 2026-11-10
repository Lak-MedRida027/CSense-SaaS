/**
 * Phase 5 security review (security-tester): desktop main-process regression tests for the gate
 * state machine, the IPC trust boundary, the token store, the protocol and URL policy, the input
 * filter (including the Login-only paste change, fea227b) and the lockdown controller.
 *
 * Tests that expose a real defect are `it.fails` and name the finding ID; once the defect is fixed
 * they start failing and must become plain `it`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNEL_NAMES, declaredMethodKeys, channelFor } from '../shared/ipc';
import { validateApiBaseUrl, loadDesktopConfig } from './config';
import type { InputEventLike } from './electron/types';
import { IpcRegistry, type IpcHandlers, type IpcMainLike } from './ipc/registry';
import { AppLock } from './lock/appLock';
import { CoverManager } from './lock/covers';
import { decideInput } from './lock/inputFilter';
import {
  isAllowedEgress,
  isAllowedNavigation,
  isAllowedSender,
  resolveAppFile,
} from './security/policy';
import {
  FakeClipboard,
  FakeDisplays,
  FakeGlobalShortcut,
  FakeWindow,
  apiError,
  jsonReply,
  recordingLogger,
} from './testing/fakes';
import { FAKE_TIMERS, advance, loginAs, server, settle, toReleased } from './testing/helpers';
import {
  OID,
  challengeStatus,
  farFuture,
  grantedStatus,
  installAuthRoutes,
  makeWorld,
  restrictedStatus,
  sessionDto,
  type World,
} from './testing/world';

beforeEach(() => {
  vi.useFakeTimers({ toFake: [...FAKE_TIMERS] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const TOKEN_TEXT = /access-token-\d|refresh-token-\d/;

/** A second app launch on the same machine: same user-data files, fresh process state. */
function relaunch(prev: World): World {
  const w = makeWorld();
  for (const [k, v] of prev.fs.files) w.fs.files.set(k, v);
  return w;
}

// ---------------------------------------------------------------------------------------------
// Gate bypass (S16, D5-5, D5-12)
// ---------------------------------------------------------------------------------------------

describe('P5 gate: release only on a server grant (S16)', () => {
  it('P5D-1: continue() is refused in every phase except granted, whatever the renderer sequence', async () => {
    const w = makeWorld();
    const state = server(w);
    expect(w.gate.continue().ok).toBe(false); // boot
    await w.gate.start();
    expect(w.gate.continue().ok).toBe(false); // signed_out
    expect(w.gate.continueOffline().ok).toBe(false);
    await loginAs(w);
    expect(w.gate.getView().phase).toBe('challenge');
    // Renderer spam: requests, foreign answers, continue.
    for (let i = 0; i < 5; i++) await w.gate.requestChallenge();
    expect(w.gate.continue().ok).toBe(false);
    w.fakeApi.on('POST /gate/attempts', apiError(409, 'GATE_CHALLENGE_STALE'));
    const foreign = await w.gate.submitAnswer({ challengeId: OID.challenge2, optionIndex: 0 });
    expect(foreign.ok).toBe(false);
    await settle();
    expect(w.gate.continue().ok).toBe(false);
    // Restricted by the server: continue and continueOffline stay refused.
    state.status = restrictedStatus;
    w.fakeApi.on('POST /gate/attempts', apiError(403, 'ACCESS_RESTRICTED'));
    await w.gate.submitAnswer({ challengeId: OID.challenge1, optionIndex: 1 });
    await settle();
    expect(w.gate.getView().phase).toBe('restricted');
    expect(w.gate.continue().ok).toBe(false);
    expect(w.gate.continueOffline().ok).toBe(false);
    expect(w.lock.state).toBe('gate');
  });

  it('P5D-2: a restricted employee stays covered while the network flaps (poll ignores errors)', async () => {
    const w = makeWorld();
    const state = server(w, restrictedStatus);
    await w.gate.start();
    await loginAs(w);
    expect(w.gate.getView().phase).toBe('restricted');
    w.fakeApi.on('GET /gate/status', { status: 0, throws: true });
    await advance(10 * 60_000);
    expect(w.gate.getView().phase).toBe('restricted');
    expect(w.gate.getView().offline).toBeNull();
    expect(w.gate.continueOffline().ok).toBe(false);
    w.fakeApi.on('GET /gate/status', () => jsonReply(200, state.status));
    await advance(61_000);
    expect(w.lock.state).toBe('gate');
  });

  it('P5-M1: a restricted employee who relaunches offline is released by "Continue offline" (D5-5 vs D5-12)', async () => {
    const first = makeWorld();
    server(first, restrictedStatus);
    await first.gate.start();
    await loginAs(first);
    expect(first.gate.getView().phase).toBe('restricted');
    expect(first.fs.text('/data/session.v1.json')).not.toBeNull();

    // Sign out of Windows, switch on airplane mode, sign back in: CSense auto-starts offline.
    const w = relaunch(first);
    installAuthRoutes(w);
    w.fakeApi.on('POST /auth/refresh', { status: 0, throws: true });
    w.fakeApi.on('GET /gate/status', { status: 0, throws: true });
    await w.gate.start();
    await settle();
    expect(w.gate.getView().phase).toBe('offline');
    await advance(121_000);

    // Secure outcome: the last server-known state for this user was "restricted", so no offline
    // release is offered and the workstation stays covered.
    const res = w.gate.continueOffline();
    expect(res.ok).toBe(false);
    expect(w.lock.state).toBe('gate');
  });

  it('P5D-3: released offline re-locks as soon as the API answers restricted or challenge (D5-12)', async () => {
    for (const answer of [restrictedStatus, challengeStatus(2)]) {
      const w = makeWorld();
      server(w);
      await w.tokens.set({
        userId: OID.user,
        accessToken: 'access-token-1',
        accessExpiresAt: Date.now() + 900_000,
        refreshToken: 'refresh-token-1',
        refreshExpiresAt: Date.now() + 1e9,
      });
      w.fakeApi.on('POST /auth/refresh', { status: 0, throws: true });
      w.fakeApi.on('GET /gate/status', { status: 0, throws: true });
      await w.gate.start();
      await settle();
      await advance(121_000);
      expect(w.gate.continueOffline().ok).toBe(true);
      expect(w.lock.state).toBe('unlocked');
      // Still offline: stays released (by design).
      await advance(60_000);
      expect(w.lock.state).toBe('unlocked');
      // The API answers again.
      installAuthRoutes(w);
      w.fakeApi.on('GET /gate/status', () => jsonReply(200, answer));
      w.fakeApi.on('POST /gate/challenge', () => jsonReply(200, answer));
      await advance(16_000);
      expect(w.lock.state).toBe('gate');
      expect(w.gate.getView().releasedOffline).toBe(false);
      expect(w.gate.continue().ok).toBe(false);
    }
  });

  it('P5-L1: an answer that resolves after sign-out still moves the gate to granted and lets continue() release', async () => {
    const w = makeWorld();
    server(w);
    await w.gate.start();
    await loginAs(w);
    expect(w.gate.getView().phase).toBe('challenge');
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    w.fakeApi.on('POST /gate/attempts', () => ({
      status: 201,
      body: { correct: true, explanation: 'x', xpEarned: 10, status: grantedStatus(farFuture()) },
      gate: held,
    }));
    const pending = w.gate.submitAnswer({ challengeId: OID.challenge1, optionIndex: 0 });
    await settle();
    await w.session.logout();
    expect(w.gate.getView().phase).toBe('signed_out');
    release();
    await pending;
    await settle();
    // Secure outcome: a result for a session that no longer exists is discarded.
    expect(w.gate.getView().phase).toBe('signed_out');
    expect(w.gate.continue().ok).toBe(false);
    expect(w.lock.state).toBe('gate');
  });

  it('P5-L2: session.login while released (after an administrator release) switches identity without re-gating', async () => {
    const w = makeWorld();
    installAuthRoutes(w, { role: 'administrator' });
    await w.gate.start();
    await loginAs(w);
    expect(w.gate.getView()).toMatchObject({ phase: 'granted', admin: true });
    expect(w.gate.continue().ok).toBe(true);
    expect(w.lock.state).toBe('unlocked');

    // A compromised renderer (or a later UI that exposes Login) signs in as an employee.
    installAuthRoutes(w, { role: 'employee', status: () => challengeStatus(3) });
    const res = await w.session.login({ email: 'emp@example.com', password: 'correct-password' });
    expect(res.ok).toBe(true);
    await settle();
    expect(w.session.getUser()?.role).toBe('employee');
    // Secure outcome: a new identity must face the gate.
    expect(w.lock.state).toBe('gate');
  });

  it('P5D-4: a clearance re-lock is deferred during lockdown and applied the moment it exits', async () => {
    const w = makeWorld();
    const state = await toReleased(w, new Date(Date.now() + 60_000).toISOString());
    w.fakeApi.on(`POST /modules/${OID.module1}/quiz/sessions`, jsonReply(201, sessionDto()));
    w.fakeApi.on(`POST /modules/${OID.module1}/quiz/sessions/${OID.session1}/abandon`, () =>
      apiError(409, 'SESSION_CLOSED'),
    );
    expect((await w.lockdown.startSecure({ kind: 'quiz', moduleId: OID.module1 })).ok).toBe(true);
    state.status = challengeStatus(3);
    await advance(70_000);
    expect(w.lock.state).toBe('lockdown');
    expect(w.gate.isReleased()).toBe(true); // queued
    await w.lockdown.exit({ sessionId: OID.session1 });
    await settle();
    expect(w.lock.state).toBe('gate');
    expect(w.gate.isReleased()).toBe(false);
    // A new quiz cannot be started to keep deferring the re-lock.
    expect(await w.lockdown.startSecure({ kind: 'quiz', moduleId: OID.module1 })).toMatchObject({
      ok: false,
      error: { code: 'GATE_LOCKED' },
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Tokens (S7, S8, S9)
// ---------------------------------------------------------------------------------------------

describe('P5 tokens: nothing token-shaped leaves main (S8) and refresh is single-flight (S9)', () => {
  it('P5D-5: no event, IPC-facing view or log line carries a token through a full gate and quiz flow', async () => {
    const w = makeWorld();
    await toReleased(w);
    w.fakeApi.on(`POST /modules/${OID.module1}/quiz/sessions`, jsonReply(201, sessionDto()));
    w.fakeApi.on(`POST /modules/${OID.module1}/quiz/attempts`, apiError(500, 'INTERNAL_ERROR'));
    const start = await w.lockdown.startSecure({ kind: 'quiz', moduleId: OID.module1 });
    const submit = await w.lockdown.submit({ sessionId: OID.session1, answers: [] });
    const views = [w.session.getView(), w.gate.getView(), w.lockdown.resume(), start, submit];
    await w.session.logout();
    const everything = JSON.stringify({
      events: w.events,
      views,
      log: w.log.events,
      sent: w.window.sent,
    });
    expect(everything).not.toMatch(TOKEN_TEXT);
    expect(everything).not.toMatch(/"(accessToken|refreshToken|authorization)"/i);
    // Logout wiped memory and the file even though the server logout is best effort.
    expect(w.tokens.getAccess()).toBeNull();
    expect(w.fs.text('/data/session.v1.json')).toBeNull();
  });

  it('P5D-6: the refresh token is never on disk in clear, and nothing is written without real encryption (S7)', async () => {
    for (const setup of [
      (x: World) => {
        x.safeStorage.available = false;
      },
      (x: World) => {
        x.safeStorage.backend = 'basic_text';
      },
    ]) {
      const w = makeWorld();
      setup(w);
      server(w, grantedStatus(farFuture()));
      await w.tokens.init();
      await loginAs(w);
      expect(w.tokens.persistence).toBe('memory_only');
      expect(w.fs.files.size).toBe(0);
    }
    const w = makeWorld();
    server(w, grantedStatus(farFuture()));
    await w.tokens.init();
    await loginAs(w);
    const file = w.fs.text('/data/session.v1.json') ?? '';
    expect(file).not.toBe('');
    expect(file).not.toMatch(TOKEN_TEXT);
  });

  it('P5D-7: concurrent 401s under a flapping network refresh once per wave and never sign the user out', async () => {
    const w = makeWorld();
    const counts = installAuthRoutes(w);
    await loginAs(w);
    let refreshDown = true;
    w.fakeApi.on('POST /auth/refresh', () => {
      counts.refreshes++;
      if (refreshDown) return { status: 0, throws: true };
      return jsonReply(200, {
        tokenType: 'Bearer',
        accessToken: 'access-token-9',
        accessTokenExpiresIn: 900,
        refreshToken: 'refresh-token-9',
        refreshTokenExpiresAt: farFuture(),
      });
    });
    w.fakeApi.on('GET /modules', (req) =>
      req.headers.authorization === 'Bearer access-token-9'
        ? jsonReply(200, { modules: [], finalTest: null })
        : apiError(401, 'UNAUTHENTICATED'),
    );
    const { OPERATIONS } = await import('./api/operations');
    const wave1 = await Promise.all(
      Array.from({ length: 6 }, () => w.api.call(OPERATIONS['modules.list'])),
    );
    expect(wave1.every((r) => !r.ok && r.error.code === 'NETWORK_UNAVAILABLE')).toBe(true);
    expect(counts.refreshes).toBe(1);
    expect(w.sessionEnded).toEqual([]);
    expect(w.tokens.getRefresh()?.refreshToken).toBe('refresh-token-1');

    refreshDown = false;
    await Promise.all(Array.from({ length: 6 }, () => w.api.call(OPERATIONS['modules.list'])));
    expect(counts.refreshes).toBe(2);
    expect(w.sessionEnded).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// IPC trust boundary (S5, S6)
// ---------------------------------------------------------------------------------------------

function fakeIpc(): IpcMainLike & {
  invoke: (key: string, event: unknown, ...args: unknown[]) => Promise<unknown>;
} {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  return {
    handle: (c, l) => handlers.set(c, l),
    removeHandler: (c) => handlers.delete(c),
    invoke: (key, event, ...args) => {
      const h = handlers.get(channelFor(key));
      if (!h) throw new Error(`no handler ${key}`);
      return Promise.resolve(h(event, ...args));
    },
  };
}

function registryWith(seen: unknown[]) {
  const ipc = fakeIpc();
  const log = recordingLogger();
  let now = 0;
  const registry = new IpcRegistry({
    ipc,
    log,
    now: () => now,
    validateSender: (e) => (e as { good?: boolean }).good === true,
  });
  const handlers = Object.fromEntries(
    declaredMethodKeys().map((k) => [
      k,
      (input: unknown) => {
        seen.push(input);
        return { ok: true, data: 'handled' };
      },
    ]),
  ) as unknown as IpcHandlers;
  registry.register(handlers, IPC_CHANNEL_NAMES);
  return { ipc, log, tick: (ms: number) => (now += ms) };
}

describe('P5 IPC: validation, sender, size and rate (S5, S6)', () => {
  it('P5D-8: prototype-pollution payloads are rejected and pollute nothing', async () => {
    const seen: unknown[] = [];
    const { ipc } = registryWith(seen);
    const good = { good: true };
    const payloads = [
      JSON.parse(`{"challengeId":"${OID.challenge1}","optionIndex":0,"__proto__":{"polluted":1}}`),
      JSON.parse(
        `{"challengeId":"${OID.challenge1}","optionIndex":0,"constructor":{"prototype":{"polluted":1}}}`,
      ),
      Object.assign(Object.create({ polluted: 1 }), {
        challengeId: OID.challenge1,
        optionIndex: 0,
      }),
    ];
    const results = [];
    for (const p of payloads) results.push(await ipc.invoke('gate.submitAnswer', good, p));
    // Inherited (prototype) keys are not own keys: zod sees a clean object and strips nothing harmful.
    expect(results.slice(0, 2)).toEqual([
      { ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid request.' } },
      { ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid request.' } },
    ]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    for (const s of seen) expect(Object.getPrototypeOf(s)).toBe(Object.prototype);
  });

  it('P5D-9: wrong sender, subframe, extra args, oversize, non-ObjectId and flood are all refused', async () => {
    const seen: unknown[] = [];
    const { ipc, tick } = registryWith(seen);
    const good = { good: true };
    expect(await ipc.invoke('gate.continue', { good: false })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN_SENDER' },
    });
    expect(await ipc.invoke('gate.continue', good, undefined, 'extra')).toMatchObject({
      error: { code: 'INVALID_INPUT' },
    });
    expect(await ipc.invoke('gate.continue', good, { force: true })).toMatchObject({
      error: { code: 'INVALID_INPUT' },
    });
    expect(
      await ipc.invoke('session.login', good, { email: 'a@b.co', password: 'x'.repeat(70_000) }),
    ).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    expect(
      await ipc.invoke('session.login', good, { email: 'a@b.co', password: 'é'.repeat(37) }),
    ).toMatchObject({ error: { code: 'INVALID_INPUT' } }); // 74 UTF-8 bytes
    for (const moduleId of ['../admin', `${OID.module1}/../x`, 'a'.repeat(23), { $ne: 1 }]) {
      expect(await ipc.invoke('learning.getQuizOverview', good, { moduleId })).toMatchObject({
        error: { code: 'INVALID_INPUT' },
      });
    }
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(await ipc.invoke('assessment.exit', good, cyclic)).toMatchObject({
      error: { code: 'INVALID_INPUT' },
    });
    // Flood: 20 per second per channel, then refused until the window moves on.
    tick(5000);
    const flood = [];
    for (let i = 0; i < 25; i++) flood.push(await ipc.invoke('gate.getView', good));
    expect(flood.filter((r) => (r as { ok: boolean }).ok)).toHaveLength(20);
    tick(1001);
    expect(await ipc.invoke('gate.getView', good)).toMatchObject({ ok: true });
    expect(seen.every((s) => s === undefined || typeof s === 'object')).toBe(true);
  });

  it('P5D-10: the sender policy accepts only the main window top frame on app://csense', () => {
    const base = { isMainWindow: true, isMainFrame: true };
    expect(isAllowedSender({ ...base, url: 'app://csense/index.html' })).toBe(true);
    expect(isAllowedSender({ ...base, isMainFrame: false, url: 'app://csense/index.html' })).toBe(
      false,
    );
    expect(isAllowedSender({ ...base, isMainWindow: false, url: 'app://csense/cover.html' })).toBe(
      false,
    );
    for (const url of [
      'app://csense.evil.com/index.html',
      'app://csense@evil.com/index.html',
      'app://csense:8080/index.html',
      'about:blank',
      'about:srcdoc',
      'data:text/html,x',
      'blob:app://csense/0f0f',
      'file:///C:/x/index.html',
      'http://localhost:5173/',
      '',
    ]) {
      expect(isAllowedSender({ ...base, url }), url).toBe(false);
    }
    // The dev origin only counts when one is configured (unpackaged).
    expect(
      isAllowedSender({
        ...base,
        url: 'http://localhost:5173/',
        devOrigin: 'http://localhost:5173',
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// app:// protocol, navigation, egress, URL policy (S2, S3, S4, S23)
// ---------------------------------------------------------------------------------------------

describe('P5 protocol and URL policy', () => {
  const root = process.platform === 'win32' ? 'C:\\app\\out\\renderer' : '/app/out/renderer';

  it('P5D-11: app:// path traversal and encoding tricks never escape the bundle root', () => {
    for (const url of [
      'app://csense/../main/index.js',
      'app://csense/..%2fmain%2findex.js',
      'app://csense/%2e%2e/main/index.js',
      'app://csense/%2E%2E%5Cmain%5Cindex.js',
      'app://csense/assets/..%5c..%5cmain/index.js',
      'app://csense/C:/Windows/win.ini',
      'app://csense/C%3A/Windows/win.ini',
      'app://csense/\\\\server\\share\\x',
      'app://csense/index.html%00.png',
      'app://csense/index.html::$DATA',
      'app://other/index.html',
      'app://user:pw@csense/index.html',
      'file:///C:/Windows/win.ini',
    ]) {
      const resolved = resolveAppFile(url, root);
      if (resolved !== null) expect(resolved.startsWith(root), url).toBe(true);
    }
    expect(resolveAppFile('app://csense/', root)).toMatch(/index\.html$/);
  });

  it('P5D-12: navigation and egress allow only the app origin (data:, blob:, file:, look-alikes refused)', () => {
    for (const url of [
      'https://example.com/',
      'file:///C:/Windows/',
      'data:text/html,<script>1</script>',
      'blob:app://csense/abc',
      'javascript:alert(1)',
      'app://csense.evil/',
      'app://evil/',
      'devtools://devtools/bundled/inspector.html',
      'chrome://gpu',
      'ws://localhost:5173/',
    ]) {
      expect(isAllowedNavigation(url), url).toBe(false);
      expect(isAllowedEgress(url), url).toBe(false);
    }
    expect(isAllowedEgress('devtools://devtools/x', { allowDevTools: false })).toBe(false);
    expect(isAllowedEgress('app://csense/assets/x.js')).toBe(true);
  });

  it('P5D-13: the API URL policy refuses downgrade and look-alike hosts; packaged builds ignore runtime overrides', () => {
    for (const raw of [
      'http://api.example.com/api/v1',
      'http://localhost.evil.com/api/v1',
      'http://127.0.0.1.nip.io/api/v1',
      'http://192.168.1.10/api/v1',
      'https://user:pw@api.example.com/api/v1',
      'https://api.example.com/api/v1?x=1',
      'https://api.example.com/api/v1#f',
      'https://api.example.com/api/v1/../../admin',
      'ftp://api.example.com/api/v1',
      'javascript://api.example.com/api/v1',
    ]) {
      expect(validateApiBaseUrl(raw, false).ok, raw).toBe(false);
      expect(validateApiBaseUrl(raw, true).ok, raw).toBe(false);
    }
    for (const raw of [
      'http://localhost:4000/api/v1',
      'http://127.0.0.1/api/v1',
      'http://[::1]:1/api/v1',
    ]) {
      expect(validateApiBaseUrl(raw, false).ok, raw).toBe(true);
      expect(validateApiBaseUrl(raw, true).ok, raw).toBe(false);
    }
    const packaged = loadDesktopConfig(
      {
        build: { MAIN_VITE_API_BASE_URL: 'https://api.example.com/api/v1' },
        env: {
          CSENSE_API_BASE_URL: 'http://127.0.0.1:1/api/v1',
          CSENSE_USER_DATA_DIR: 'C:\\evil',
          CSENSE_DEVTOOLS: '1',
          CSENSE_GATE_POLL_SECONDS: '2',
        },
      },
      { isPackaged: true },
    );
    expect(packaged).toMatchObject({
      apiBaseUrl: 'https://api.example.com/api/v1',
      userDataDir: null,
      devToolsInDev: false,
      gateRestrictedPollSeconds: 60,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Input filter and the Login-only paste change (fea227b) (S18, S20)
// ---------------------------------------------------------------------------------------------

const key = (k: string, mods: Partial<InputEventLike> = {}): InputEventLike => ({
  type: 'keyDown',
  key: k,
  code: '',
  control: false,
  shift: false,
  alt: false,
  meta: false,
  ...mods,
});

describe('P5 input filter (S18, S20) and Login-only paste (fea227b)', () => {
  it('P5D-14: lockdown ignores allowPaste and blocks AltGr, IME, dead keys, media/edit keys and copy paths', () => {
    const ctx = { allowPaste: true };
    for (const input of [
      key('v', { control: true }),
      key('V', { control: true, shift: true }),
      key('Insert', { shift: true }),
      key('Insert', { control: true }),
      key('c', { control: true }),
      key('x', { control: true }),
      key('a', { control: true }),
      key('@', { control: true, alt: true }), // AltGr
      key('Dead'),
      key('Process'),
      key('Paste'),
      key('Copy'),
      key('Cut'),
      key('BrowserBack'),
      key('BrowserRefresh'),
      key('ContextMenu'),
      key('F10', { shift: true }),
      key('a'),
      key('Delete', { shift: true }),
    ]) {
      expect(decideInput('lockdown', input, ctx).allow, JSON.stringify(input)).toBe(false);
    }
    // Keyboard exit stays possible (WCAG 2.1.2).
    for (const input of [
      key('Tab'),
      key('Tab', { shift: true }),
      key('Enter'),
      key(' '),
      key('Escape'),
    ]) {
      expect(decideInput('lockdown', input, ctx).allow).toBe(true);
    }
  });

  it("P5D-15: in the gate, paste follows main's own phase only; copy and cut never pass", () => {
    const window = new FakeWindow();
    let phase = 'signed_out';
    const lock = new AppLock({
      window,
      covers: new CoverManager(new FakeDisplays()),
      clipboard: new FakeClipboard(),
      globalShortcut: new FakeGlobalShortcut(),
      log: recordingLogger(),
      allowPaste: () => phase === 'signed_out',
    });
    lock.lock('gate');
    expect(window.press(key('v', { control: true }))).toBe(false); // allowed (not prevented)
    expect(window.press(key('Insert', { shift: true }))).toBe(false);
    expect(window.press(key('c', { control: true }))).toBe(true);
    expect(window.press(key('Insert', { control: true }))).toBe(true);
    expect(window.press(key('V', { control: true, shift: true }))).toBe(true);
    for (const p of ['challenge', 'granted', 'restricted', 'offline', 'misconfigured', 'boot']) {
      phase = p;
      expect(window.press(key('v', { control: true })), p).toBe(true);
    }
    // A provider that throws fails closed.
    const throwingWindow = new FakeWindow();
    const throwing = new AppLock({
      window: throwingWindow,
      covers: new CoverManager(new FakeDisplays()),
      clipboard: new FakeClipboard(),
      globalShortcut: new FakeGlobalShortcut(),
      log: recordingLogger(),
      allowPaste: () => {
        throw new Error('boom');
      },
    });
    throwing.lock('gate');
    expect(throwingWindow.press(key('v', { control: true }))).toBe(true);
    // Lockdown: never, even when the provider says yes.
    phase = 'signed_out';
    lock.lock('lockdown');
    expect(window.press(key('v', { control: true }))).toBe(true);
    expect(window.press(key('Insert', { shift: true }))).toBe(true);
    lock.unlock();
  });

  it('P5D-16: the real gate phase is signed_out only on the Login step', async () => {
    const w = makeWorld();
    server(w);
    await w.gate.start();
    expect(w.gate.getView().phase).toBe('signed_out');
    await loginAs(w);
    expect(w.gate.getView().phase).toBe('challenge');
  });
});

// ---------------------------------------------------------------------------------------------
// Lockdown (S17, S19, S20)
// ---------------------------------------------------------------------------------------------

describe('P5 lockdown', () => {
  async function inQuiz(w: World): Promise<void> {
    await toReleased(w);
    w.fakeApi.on(`POST /modules/${OID.module1}/quiz/sessions`, jsonReply(201, sessionDto()));
    w.fakeApi.on(`POST /modules/${OID.module1}/quiz/sessions/${OID.session1}/abandon`, () =>
      apiError(409, 'SESSION_CLOSED'),
    );
    expect((await w.lockdown.startSecure({ kind: 'quiz', moduleId: OID.module1 })).ok).toBe(true);
    expect(w.lock.state).toBe('lockdown');
  }

  it('P5D-17: a foreign or stale sessionId cannot submit or exit, and resume returns only the cached session', async () => {
    const w = makeWorld();
    await inQuiz(w);
    for (const sessionId of [OID.session2, OID.session1.toUpperCase().slice(0, 23) + 'D']) {
      expect(await w.lockdown.submit({ sessionId, answers: [] })).toMatchObject({
        ok: false,
        error: { code: 'LOCKDOWN_NOT_ACTIVE' },
      });
      expect(await w.lockdown.exit({ sessionId })).toMatchObject({
        ok: false,
        error: { code: 'LOCKDOWN_NOT_ACTIVE' },
      });
    }
    expect(w.lock.state).toBe('lockdown');
    expect(w.lockdown.resume()?.session.sessionId).toBe(OID.session1);
    expect(JSON.stringify(w.lockdown.resume())).not.toMatch(/correct/i);
  });

  it('P5D-18: lockdown cannot be entered while the gate is locked, nor twice', async () => {
    const w = makeWorld();
    server(w);
    await w.gate.start();
    await loginAs(w);
    expect(await w.lockdown.startSecure({ kind: 'final' })).toMatchObject({
      ok: false,
      error: { code: 'GATE_LOCKED' },
    });
    expect(w.fakeApi.count('POST /final-test/sessions')).toBe(0);

    const r = makeWorld();
    await toReleased(r);
    let release: () => void = () => undefined;
    const held = new Promise<void>((res) => {
      release = res;
    });
    r.fakeApi.on('POST /final-test/sessions', () => ({
      status: 201,
      body: sessionDto(),
      gate: held,
    }));
    const first = r.lockdown.startSecure({ kind: 'final' });
    await settle();
    expect(await r.lockdown.startSecure({ kind: 'final' })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    release();
    expect((await first).ok).toBe(true);
  });

  it('P5D-19: sign-out and exit unlock synchronously, before any network call', async () => {
    const w = makeWorld();
    await inQuiz(w);
    w.fakeApi.on(`POST /modules/${OID.module1}/quiz/sessions/${OID.session1}/abandon`, {
      status: 0,
      throws: true,
    });
    w.lockdown.leaveForSignOut();
    expect(w.lock.state).toBe('unlocked');
    expect(w.window.contentProtected).toBe(false);
    expect(w.clipboard.clears).toBeGreaterThanOrEqual(2);
    await advance(10_000);
    expect(w.lockdown.getPending().map((p) => p.sessionId)).toEqual([OID.session1]);
  });

  it('P5D-20: devtools, blocked keys and short blurs never exit lockdown; the third real blur abandons', async () => {
    const w = makeWorld();
    await inQuiz(w);
    w.window.openDevTools();
    expect(w.window.devToolsOpen).toBe(false);
    expect(w.window.press(key('F12'))).toBe(true);
    expect(w.window.press(key('r', { control: true }))).toBe(true);
    expect(w.window.tryClose()).toBe(true);
    // A flick under 500 ms is ignored entirely.
    w.window.doBlur();
    await advance(200);
    w.window.doFocus();
    expect(w.lock.state).toBe('lockdown');
    for (let i = 0; i < 3; i++) {
      w.window.doBlur();
      await advance(600);
      w.window.doFocus();
    }
    expect(w.lock.state).toBe('unlocked');
    expect(w.lockdown.getState()).toBe('inactive');
  });
});
