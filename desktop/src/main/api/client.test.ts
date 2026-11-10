import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, jsonReply } from '../testing/fakes';
import { OID, installAuthRoutes, makeWorld, type World } from '../testing/world';
import { OPERATIONS } from './operations';
import { ApiClient } from './client';

const emptyOverview = {
  modules: [],
  totalModules: 0,
  completedCount: 0,
  nextModuleId: null,
  finalTest: null,
};

async function signedIn(w: World = makeWorld()) {
  const counts = installAuthRoutes(w);
  const res = await w.session.login({ email: 'user@example.com', password: 'correct-password' });
  expect(res.ok).toBe(true);
  return { w, counts };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ApiClient', () => {
  it('AC1: attaches the bearer token from memory; login itself is unauthenticated', async () => {
    const { w } = await signedIn();
    w.fakeApi.on('GET /modules', jsonReply(200, emptyOverview));
    const res = await w.api.call(OPERATIONS['modules.list']);
    expect(res.ok).toBe(true);
    const req = w.fakeApi.requests.find((r) => r.path === '/modules');
    expect(req?.headers.authorization).toBe('Bearer access-token-1');
    const login = w.fakeApi.requests.find((r) => r.path === '/auth/login');
    expect(login?.headers.authorization).toBeUndefined();
  });

  it('AC2 (S9): 10 concurrent 401s cause exactly ONE refresh and each request is retried once', async () => {
    const { w, counts } = await signedIn();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    // Slow refresh so all ten requests hit their 401 before it completes.
    w.fakeApi.on('POST /auth/refresh', () => {
      counts.refreshes++;
      return {
        status: 200,
        gate,
        body: {
          tokenType: 'Bearer',
          accessToken: 'access-token-2',
          accessTokenExpiresIn: 900,
          refreshToken: 'refresh-token-2',
          refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      };
    });
    w.fakeApi.on('GET /modules', (req) =>
      req.headers.authorization === 'Bearer access-token-2'
        ? jsonReply(200, emptyOverview)
        : apiError(401, 'UNAUTHENTICATED'),
    );
    const calls = Array.from({ length: 10 }, () => w.api.call(OPERATIONS['modules.list']));
    await vi.waitFor(() => {
      expect(w.fakeApi.count('GET /modules')).toBe(10);
    });
    release();
    const results = await Promise.all(calls);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(counts.refreshes).toBe(1);
    expect(w.fakeApi.count('POST /auth/refresh')).toBe(1);
    expect(w.fakeApi.count('GET /modules')).toBe(20); // 10 first tries + 10 retries
    expect(w.sessionEnded).toEqual([]);
  });

  it('a late 401 after a refresh already finished retries without a second refresh', async () => {
    const { w } = await signedIn();
    let calls = 0;
    w.fakeApi.on('GET /modules', (req) => {
      calls++;
      // First call's token is stale; later ones succeed.
      return req.headers.authorization === 'Bearer access-token-1'
        ? apiError(401, 'UNAUTHENTICATED')
        : jsonReply(200, emptyOverview);
    });
    expect((await w.api.call(OPERATIONS['modules.list'])).ok).toBe(true);
    expect((await w.api.call(OPERATIONS['modules.list'])).ok).toBe(true);
    expect(w.fakeApi.count('POST /auth/refresh')).toBe(1);
    expect(calls).toBe(3);
  });

  it('AC3: INVALID_REFRESH_TOKEN wipes memory and file and ends the session', async () => {
    const { w } = await signedIn();
    expect(w.fs.files.size).toBe(1);
    w.fakeApi.on('GET /modules', apiError(401, 'UNAUTHENTICATED'));
    w.fakeApi.on('POST /auth/refresh', apiError(401, 'INVALID_REFRESH_TOKEN'));
    const res = await w.api.call(OPERATIONS['modules.list']);
    expect(res).toMatchObject({ ok: false, error: { code: 'NOT_SIGNED_IN' } });
    expect(w.tokens.getAccess()).toBeNull();
    expect(w.tokens.getRefresh()).toBeNull();
    expect(w.fs.files.size).toBe(0);
    expect(w.sessionEnded).toEqual(['refresh_rejected']);
    expect(w.session.getView()).toMatchObject({
      status: 'signed_out',
      endedNotice: 'session_ended',
    });
  });

  it('a 401 that persists after a successful refresh ends the session', async () => {
    const { w } = await signedIn();
    w.fakeApi.on('GET /modules', apiError(401, 'UNAUTHENTICATED'));
    const res = await w.api.call(OPERATIONS['modules.list']);
    expect(res).toMatchObject({ ok: false, error: { code: 'NOT_SIGNED_IN' } });
    expect(w.sessionEnded).toEqual(['unauthenticated']);
    expect(w.tokens.getRefresh()).toBeNull();
  });

  it('AC4: no retry on 403 or 409, and the error carries code and retry hints', async () => {
    const { w } = await signedIn();
    w.fakeApi.on('GET /modules', apiError(403, 'ACCESS_RESTRICTED'));
    expect(await w.api.call(OPERATIONS['modules.list'])).toMatchObject({
      ok: false,
      error: { code: 'ACCESS_RESTRICTED', status: 403 },
    });
    w.fakeApi.on(
      'POST /final-test/sessions',
      apiError(409, 'ASSESSMENT_COOLDOWN', {
        details: { retryAt: '2026-11-10T12:00:00.000Z' },
        headers: { 'retry-after': '120' },
      }),
    );
    expect(await w.api.call(OPERATIONS['final.startSession'])).toMatchObject({
      ok: false,
      error: {
        code: 'ASSESSMENT_COOLDOWN',
        retryAfterSeconds: 120,
        details: { retryAt: '2026-11-10T12:00:00.000Z' },
      },
    });
    expect(w.fakeApi.count('GET /modules')).toBe(1);
    expect(w.fakeApi.count('POST /final-test/sessions')).toBe(1);
    expect(w.fakeApi.count('POST /auth/refresh')).toBe(0);
  });

  it('AC5: refreshes before sending when the access token has under 60 s left', async () => {
    const w = makeWorld();
    const counts = installAuthRoutes(w);
    w.fakeApi.on('GET /modules', (req) =>
      req.headers.authorization === 'Bearer access-token-2'
        ? jsonReply(200, emptyOverview)
        : apiError(401, 'UNAUTHENTICATED'),
    );
    await w.tokens.set({
      userId: OID.user,
      accessToken: 'access-token-1',
      accessExpiresAt: Date.now() + 30_000,
      refreshToken: 'refresh-token-1',
      refreshExpiresAt: Date.now() + 86_400_000,
    });
    const res = await w.api.call(OPERATIONS['modules.list']);
    expect(res.ok).toBe(true);
    expect(counts.refreshes).toBe(1);
    // The expiring token was never sent.
    expect(w.fakeApi.requests.filter((r) => r.path === '/modules')).toHaveLength(1);
  });

  it('AC6: while locked down, a proactive refresh runs 120 s before expiry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { w, counts } = await signedIn();
    w.api.armProactiveRefresh(true);
    await vi.advanceTimersByTimeAsync(900_000 - 120_000 - 1000);
    expect(counts.refreshes).toBe(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(counts.refreshes).toBe(1);
    // It re-arms for the new token.
    await vi.advanceTimersByTimeAsync(900_000 - 120_000);
    expect(counts.refreshes).toBe(2);
    w.api.armProactiveRefresh(false);
    await vi.advanceTimersByTimeAsync(2_000_000);
    expect(counts.refreshes).toBe(2);
  });

  it('AC7: the rotated refresh token is persisted BEFORE the refresh promise resolves', async () => {
    const { w } = await signedIn();
    const order: string[] = [];
    const orig = w.fs.rename.bind(w.fs);
    w.fs.rename = async (from, to) => {
      await orig(from, to);
      order.push('persisted');
    };
    await w.api.refresh().then(() => order.push('resolved'));
    expect(order).toEqual(['persisted', 'resolved']);
  });

  it('AC8: a response that does not match the strict schema is BAD_RESPONSE (no token or key reaches the UI)', async () => {
    const { w } = await signedIn();
    w.fakeApi.on('GET /modules', jsonReply(200, { ...emptyOverview, accessToken: 'leak' }));
    expect(await w.api.call(OPERATIONS['modules.list'])).toMatchObject({
      ok: false,
      error: { code: 'BAD_RESPONSE' },
    });
    w.fakeApi.on('GET /gate/status', jsonReply(200, { state: 'challenge', correctAnswer: 1 }));
    expect(await w.api.call(OPERATIONS['gate.status'])).toMatchObject({
      ok: false,
      error: { code: 'BAD_RESPONSE' },
    });
  });

  it('AC9: path parameters are validated and encoded; nothing is sent for a bad id', async () => {
    const { w } = await signedIn();
    for (const bad of ['../auth/login', 'abc', `${OID.module1}/../x`, `${OID.module1}?x=1`, '']) {
      const res = await w.api.call(OPERATIONS['modules.quizOverview'], {
        params: { moduleId: bad },
      });
      expect(res, bad).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    }
    expect(w.fakeApi.requests.some((r) => r.path.startsWith('/modules/'))).toBe(false);
    expect(
      OPERATIONS['quiz.abandon'].path({ moduleId: OID.module1, sessionId: OID.session1 }),
    ).toBe(`/modules/${OID.module1}/quiz/sessions/${OID.session1}/abandon`);
  });

  it('AC10: a timeout is NETWORK_UNAVAILABLE', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const w = makeWorld();
    installAuthRoutes(w);
    await w.tokens.set({
      userId: OID.user,
      accessToken: 'a',
      accessExpiresAt: Date.now() + 900_000,
      refreshToken: 'r',
      refreshExpiresAt: Date.now() + 1e9,
    });
    const client = new ApiClient({
      baseUrl: w.fakeApi.baseUrl,
      tokens: w.tokens,
      log: w.log,
      onSessionEnded: () => undefined,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    });
    const p = client.call(OPERATIONS['modules.list']);
    await vi.advanceTimersByTimeAsync(15_001);
    expect(await p).toMatchObject({ ok: false, error: { code: 'NETWORK_UNAVAILABLE' } });
  });

  it('a transport failure is NETWORK_UNAVAILABLE and keeps the session', async () => {
    const { w } = await signedIn();
    w.fakeApi.on('GET /modules', { status: 0, throws: true });
    expect(await w.api.call(OPERATIONS['modules.list'])).toMatchObject({
      ok: false,
      error: { code: 'NETWORK_UNAVAILABLE' },
    });
    expect(w.tokens.getRefresh()).not.toBeNull();
    expect(w.sessionEnded).toEqual([]);
  });

  it('a 5xx without an error envelope is not a client error; 503 GATE_UNAVAILABLE keeps its code', async () => {
    const { w } = await signedIn();
    w.fakeApi.on('GET /modules', { status: 502, body: undefined });
    expect(await w.api.call(OPERATIONS['modules.list'])).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR', status: 502 },
    });
    w.fakeApi.on('GET /gate/status', apiError(503, 'GATE_UNAVAILABLE'));
    expect(await w.api.call(OPERATIONS['gate.status'])).toMatchObject({
      ok: false,
      error: { code: 'GATE_UNAVAILABLE' },
    });
  });

  it('refresh while offline keeps the session (network is not a revocation)', async () => {
    const { w } = await signedIn();
    w.fakeApi.on('POST /auth/refresh', { status: 0, throws: true });
    expect(await w.api.refresh()).toBe('network');
    expect(w.tokens.getRefresh()).not.toBeNull();
    expect(w.sessionEnded).toEqual([]);
  });

  it('calling a bearer operation with no session is NOT_SIGNED_IN and sends nothing', async () => {
    const w = makeWorld();
    installAuthRoutes(w);
    expect(await w.api.call(OPERATIONS['modules.list'])).toMatchObject({
      ok: false,
      error: { code: 'NOT_SIGNED_IN' },
    });
    expect(w.fakeApi.requests).toHaveLength(0);
  });

  it('refuses an over-sized request body and invalid bodies without sending', async () => {
    const { w } = await signedIn();
    const res = await w.api.call(OPERATIONS['final.submit'], {
      body: { sessionId: OID.session1, answers: [{ questionId: 'nope', selectedIndex: 1 }] },
    });
    expect(res).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(w.fakeApi.count('POST /final-test/attempts')).toBe(0);
  });

  it('never lets a token appear in any result handed to callers', async () => {
    const { w } = await signedIn();
    const login = await w.session.login({
      email: 'user@example.com',
      password: 'correct-password',
    });
    expect(JSON.stringify(login)).not.toMatch(/token-\d|accessToken|refreshToken/i);
    expect(JSON.stringify(w.session.getView())).not.toMatch(/token-\d|accessToken|refreshToken/i);
  });
});
