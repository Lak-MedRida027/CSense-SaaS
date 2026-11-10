import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, jsonReply } from '../testing/fakes';
import {
  OID,
  attemptDto,
  challengeStatus,
  farFuture,
  grantedStatus,
  installAuthRoutes,
  makeWorld,
  requiredStatus,
  restrictedStatus,
  sessionDto,
  type World,
} from '../testing/world';
import type { GateStatusDTO } from '@csense/shared';

const FAKE = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] as const;

const settle = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await new Promise<void>((r) => setImmediate(r));
};
const advance = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: [...FAKE] });
});
afterEach(() => {
  vi.useRealTimers();
});

/** Server state the fake routes read from. */
function server(w: World, initial: GateStatusDTO = requiredStatus) {
  const state = { status: initial, nextChallenge: challengeStatus(3) };
  installAuthRoutes(w);
  w.fakeApi.on('GET /gate/status', () => jsonReply(200, state.status));
  w.fakeApi.on('POST /gate/challenge', () => {
    if (state.status.state === 'required') state.status = state.nextChallenge;
    return jsonReply(200, state.status);
  });
  return state;
}

async function loginAs(w: World): Promise<void> {
  const res = await w.session.login({ email: 'user@example.com', password: 'correct-password' });
  expect(res.ok).toBe(true);
  await settle();
}

async function toChallenge(w: World) {
  const state = server(w);
  await w.gate.start();
  await loginAs(w);
  expect(w.gate.getView().phase).toBe('challenge');
  return state;
}

async function toReleased(w: World, clearedUntil = farFuture()) {
  const state = server(w, grantedStatus(clearedUntil));
  await w.gate.start();
  await loginAs(w);
  expect(w.gate.getView().phase).toBe('granted');
  expect(w.gate.continue().ok).toBe(true);
  expect(w.lock.state).toBe('unlocked');
  return state;
}

describe('GateController', () => {
  it('GC1: the window is locked and covered BEFORE the first network request', async () => {
    const w = makeWorld();
    installAuthRoutes(w);
    // A persisted session forces a refresh request at start-up.
    await w.tokens.set({
      userId: OID.user,
      accessToken: 'access-token-1',
      accessExpiresAt: Date.now() - 1,
      refreshToken: 'refresh-token-1',
      refreshExpiresAt: Date.now() + 1e9,
    });
    w.fakeApi.on('GET /gate/status', jsonReply(200, requiredStatus));
    w.fakeApi.on('POST /gate/challenge', jsonReply(200, challengeStatus()));
    const lockedAtFirstRequest: boolean[] = [];
    const orig = w.fakeApi.fetch;
    const wrapped: typeof w.fakeApi.fetch = (u, i) => {
      lockedAtFirstRequest.push(w.window.kiosk && w.window.alwaysOnTop && !w.window.closable);
      return orig(u, i);
    };
    // Rebuild the client with the recording fetch.
    const { ApiClient } = await import('../api/client');
    const { GateController } = await import('./gateController');
    const { SessionService } = await import('../session/sessionService');
    const api = new ApiClient({
      baseUrl: w.fakeApi.baseUrl,
      fetch: wrapped,
      tokens: w.tokens,
      log: w.log,
      onSessionEnded: () => undefined,
    });
    const session = new SessionService({
      api,
      tokens: w.tokens,
      log: w.log,
      emit: () => undefined,
    });
    const gate = new GateController({
      config: w.config,
      lock: w.lock,
      api,
      session,
      power: w.power,
      gateState: w.gateState,
      offlineReports: w.offlineReports,
      log: w.log,
      emit: () => undefined,
    });
    await gate.start();
    await settle();
    expect(lockedAtFirstRequest.length).toBeGreaterThan(0);
    expect(lockedAtFirstRequest.every(Boolean)).toBe(true);
    expect(w.displays.openCovers).toBe(0); // single display: nothing else to cover
    expect(gate.getView().phase).toBe('challenge');
  });

  it('GC1b: a misconfigured build stays locked, makes no request and says so', async () => {
    const w = makeWorld({ apiBaseUrl: null, configError: 'API base URL not set' });
    await w.gate.start();
    expect(w.gate.getView().phase).toBe('misconfigured');
    expect(w.window.kiosk).toBe(true);
    expect(w.fakeApi.requests).toHaveLength(0);
    expect(w.gate.continue()).toMatchObject({ ok: false, error: { code: 'GATE_LOCKED' } });
    expect((await w.gate.requestChallenge()).ok).toBe(false);
  });

  it('GC2 (S16): continue() is refused in every phase except a server-granted one', async () => {
    const w = makeWorld();
    const state = server(w);
    // boot, before start
    expect(w.gate.continue()).toMatchObject({ ok: false, error: { code: 'GATE_LOCKED' } });
    await w.gate.start();
    expect(w.gate.getView().phase).toBe('signed_out');
    expect(w.gate.continue()).toMatchObject({ ok: false, error: { code: 'GATE_LOCKED' } });
    await loginAs(w);
    expect(w.gate.getView().phase).toBe('challenge');
    expect(w.gate.continue()).toMatchObject({ ok: false, error: { code: 'GATE_LOCKED' } });
    expect(w.lock.state).toBe('gate');
    expect(w.window.kiosk).toBe(true);
    state.status = restrictedStatus;
    await w.gate.requestChallenge();
    expect(w.gate.getView().phase).toBe('restricted');
    expect(w.gate.continue()).toMatchObject({ ok: false, error: { code: 'GATE_LOCKED' } });
    expect(w.lock.state).toBe('gate');
  });

  it('GC3: a wrong answer shows feedback and a new question; the correct answer grants; only then does continue() release', async () => {
    const w = makeWorld();
    const state = await toChallenge(w);
    expect(w.gate.getView()).toMatchObject({
      phase: 'challenge',
      maxAttempts: 3,
      attemptsRemaining: 3,
      challenge: { challengeId: OID.challenge1 },
    });

    w.fakeApi.on('POST /gate/attempts', (req) => {
      const body = req.body as { challengeId: string; selectedIndex: number };
      expect(body).toEqual({ challengeId: OID.challenge1, selectedIndex: 0 });
      return jsonReply(201, {
        correct: false,
        explanation: 'Not that one.',
        xpEarned: 0,
        status: challengeStatus(2, OID.challenge2),
      });
    });
    const wrong = await w.gate.submitAnswer({ challengeId: OID.challenge1, optionIndex: 0 });
    expect(wrong).toMatchObject({
      ok: true,
      data: {
        correct: false,
        explanation: 'Not that one.',
        view: { phase: 'challenge', attemptsRemaining: 2 },
      },
    });
    expect(w.gate.getView().challenge?.challengeId).toBe(OID.challenge2);
    expect(w.gate.getView().feedback).toEqual({ correct: false, explanation: 'Not that one.' });

    w.fakeApi.on('POST /gate/attempts', () =>
      jsonReply(201, {
        correct: true,
        explanation: 'Right.',
        xpEarned: 10,
        status: grantedStatus(farFuture()),
      }),
    );
    state.status = grantedStatus(farFuture());
    const right = await w.gate.submitAnswer({ challengeId: OID.challenge2, optionIndex: 1 });
    expect(right).toMatchObject({
      ok: true,
      data: { correct: true, xpEarned: 10, view: { phase: 'granted', autoContinue: false } },
    });
    expect(w.lock.state).toBe('gate'); // still locked until continue()
    expect(w.gate.continue().ok).toBe(true);
    expect(w.lock.state).toBe('unlocked');
    expect(w.window.kiosk).toBe(false);
    expect(w.gate.getView().phase).toBe('released');
  });

  it('three wrong answers end in restricted, which keeps the window locked', async () => {
    const w = makeWorld();
    await toChallenge(w);
    w.fakeApi.on('POST /gate/attempts', () =>
      jsonReply(201, { correct: false, explanation: 'No.', xpEarned: 0, status: restrictedStatus }),
    );
    const res = await w.gate.submitAnswer({ challengeId: OID.challenge1, optionIndex: 2 });
    expect(res).toMatchObject({ ok: true, data: { view: { phase: 'restricted' } } });
    expect(w.gate.getView().restricted?.referenceId).toBe('GATE-20261110-ABC123');
    expect(w.lock.state).toBe('gate');
    expect(JSON.stringify(w.gate.getView())).not.toMatch(/correctAnswer|correctIndex/);
  });

  it('a stale challenge (409) re-checks the server instead of trusting local state', async () => {
    const w = makeWorld();
    const state = await toChallenge(w);
    state.status = challengeStatus(2, OID.challenge2);
    w.fakeApi.on('POST /gate/attempts', apiError(409, 'GATE_CHALLENGE_STALE'));
    const res = await w.gate.submitAnswer({ challengeId: OID.challenge1, optionIndex: 0 });
    expect(res).toMatchObject({ ok: false, error: { code: 'GATE_CHALLENGE_STALE' } });
    await settle();
    expect(w.gate.getView().challenge?.challengeId).toBe(OID.challenge2);
  });

  it('submitAnswer is refused outside the challenge phase and sends nothing', async () => {
    const w = makeWorld();
    server(w);
    await w.gate.start();
    const res = await w.gate.submitAnswer({ challengeId: OID.challenge1, optionIndex: 0 });
    expect(res).toMatchObject({ ok: false, error: { code: 'GATE_LOCKED' } });
    expect(w.fakeApi.count('POST /gate/attempts')).toBe(0);
  });

  it('an existing clearance at start-up shows granted with auto-continue and asks nothing', async () => {
    const w = makeWorld();
    server(w, grantedStatus(farFuture()));
    await w.tokens.set({
      userId: OID.user,
      accessToken: 'access-token-1',
      accessExpiresAt: Date.now() + 900_000,
      refreshToken: 'refresh-token-1',
      refreshExpiresAt: Date.now() + 1e9,
    });
    await w.gate.start();
    await settle();
    expect(w.gate.getView()).toMatchObject({ phase: 'granted', autoContinue: true });
    expect(w.fakeApi.count('POST /gate/challenge')).toBe(0);
  });

  it('GC4: re-locks at clearedUntil', async () => {
    const w = makeWorld();
    const until = new Date(Date.now() + 10 * 60_000).toISOString();
    const state = await toReleased(w, until);
    state.status = requiredStatus;
    await advance(9 * 60_000);
    expect(w.lock.state).toBe('unlocked');
    await advance(61_000);
    expect(w.lock.state).toBe('gate');
    expect(w.window.kiosk).toBe(true);
    expect(w.gate.getView().phase).toBe('challenge');
  });

  it('GC5: unlock-screen / resume re-checks; an expired clearance brings the gate back', async () => {
    const w = makeWorld();
    const state = await toReleased(w, new Date(Date.now() + 60 * 60_000).toISOString());
    // Valid clearance, server still says granted: stays open.
    w.power.fire('unlock-screen');
    await settle();
    expect(w.lock.state).toBe('unlocked');
    // Restricted elsewhere while the screen was locked.
    state.status = restrictedStatus;
    w.power.fire('resume');
    await settle();
    expect(w.lock.state).toBe('gate');
    expect(w.gate.getView().phase).toBe('restricted');
  });

  it('GC5b: resume with an expired clearance relocks without waiting for the timer', async () => {
    const w = makeWorld();
    const state = await toReleased(w, new Date(Date.now() + 5 * 60_000).toISOString());
    state.status = requiredStatus;
    vi.setSystemTime(Date.now() + 6 * 60_000); // timer is paused (system slept), clock moved on
    w.power.fire('resume');
    await settle();
    expect(w.lock.state).toBe('gate');
  });

  describe('GC6: offline policy (D5-12)', () => {
    async function offlineStart(w: World) {
      server(w);
      await w.tokens.set({
        userId: OID.user,
        accessToken: 'access-token-1',
        accessExpiresAt: Date.now() + 900_000,
        refreshToken: 'refresh-token-1',
        refreshExpiresAt: Date.now() + 1e9,
      });
      // The whole API is down.
      w.fakeApi.on('POST /auth/refresh', { status: 0, throws: true });
      w.fakeApi.on('GET /gate/status', { status: 0, throws: true });
      await w.gate.start();
      await settle();
    }

    it('open_after_grace: Continue offline appears after the grace period, not before', async () => {
      const w = makeWorld();
      await offlineStart(w);
      expect(w.gate.getView().phase).toBe('offline');
      expect(w.gate.getView().offline).toMatchObject({
        graceElapsed: false,
        canContinueOffline: false,
      });
      expect(w.gate.continueOffline()).toMatchObject({ ok: false, error: { code: 'GATE_LOCKED' } });
      expect(w.lock.state).toBe('gate');

      await advance(119_000);
      expect(w.gate.getView().offline?.canContinueOffline).toBe(false);
      await advance(2000);
      expect(w.gate.getView().offline).toMatchObject({
        graceElapsed: true,
        canContinueOffline: true,
      });
      expect(w.gate.continueOffline().ok).toBe(true);
      expect(w.lock.state).toBe('unlocked');
      expect(w.gate.getView()).toMatchObject({ phase: 'released', releasedOffline: true });
      expect(w.log.events.some((e) => e.event === 'gate.released_offline')).toBe(true);
    });

    it('closed: never offers a way in, however long the outage', async () => {
      const w = makeWorld({ gateOfflinePolicy: 'closed' });
      await offlineStart(w);
      await advance(3_600_000);
      expect(w.gate.getView().offline).toMatchObject({ canContinueOffline: false });
      expect(w.gate.continueOffline()).toMatchObject({ ok: false });
      expect(w.lock.state).toBe('gate');
    });

    it('GC7: released offline, the gate re-locks as soon as the API answers and no clearance exists', async () => {
      const w = makeWorld();
      await offlineStart(w);
      await advance(121_000);
      expect(w.gate.continueOffline().ok).toBe(true);
      // Still down: stays released.
      await advance(30_000);
      expect(w.lock.state).toBe('unlocked');
      // API returns.
      w.fakeApi.on('POST /auth/refresh', () =>
        jsonReply(200, {
          tokenType: 'Bearer',
          accessToken: 'access-token-9',
          accessTokenExpiresIn: 900,
          refreshToken: 'refresh-token-9',
          refreshTokenExpiresAt: new Date(Date.now() + 1e9).toISOString(),
        }),
      );
      w.fakeApi.on('GET /gate/status', jsonReply(200, requiredStatus));
      await advance(16_000);
      expect(w.lock.state).toBe('gate');
      expect(w.gate.getView().phase).toBe('challenge');
      expect(w.gate.getView().releasedOffline).toBe(false);
    });

    it('released offline stays open if the server turns out to hold a valid clearance', async () => {
      const w = makeWorld();
      await offlineStart(w);
      await advance(121_000);
      w.gate.continueOffline();
      w.fakeApi.on('POST /auth/refresh', () =>
        jsonReply(200, {
          tokenType: 'Bearer',
          accessToken: 'access-token-9',
          accessTokenExpiresIn: 900,
          refreshToken: 'refresh-token-9',
          refreshTokenExpiresAt: new Date(Date.now() + 1e9).toISOString(),
        }),
      );
      w.fakeApi.on('GET /auth/me', () =>
        jsonReply(200, { id: OID.user, name: 'T', role: 'employee' }),
      );
      w.fakeApi.on('GET /gate/status', jsonReply(200, grantedStatus(farFuture())));
      await advance(16_000);
      expect(w.lock.state).toBe('unlocked');
      expect(w.gate.getView().releasedOffline).toBe(false);
    });

    it('a 5xx or GATE_UNAVAILABLE is treated like offline, not as a pass', async () => {
      const w = makeWorld();
      server(w);
      await w.gate.start();
      w.fakeApi.on('GET /gate/status', apiError(503, 'GATE_UNAVAILABLE'));
      await loginAs(w);
      expect(w.gate.getView().phase).toBe('offline');
      expect(w.lock.state).toBe('gate');
    });
  });

  it('GC8: restricted polls and moves to a fresh challenge after an admin restore', async () => {
    const w = makeWorld();
    const state = server(w, restrictedStatus);
    await w.gate.start();
    await loginAs(w);
    expect(w.gate.getView().phase).toBe('restricted');
    await advance(59_000);
    expect(w.fakeApi.count('GET /gate/status')).toBe(1);
    await advance(2000);
    expect(w.gate.getView().phase).toBe('restricted'); // polled, still restricted
    state.status = requiredStatus; // admin restored
    await advance(60_000);
    expect(w.gate.getView().phase).toBe('challenge');
    expect(w.gate.getView().attemptsRemaining).toBe(3);
    expect(w.lock.state).toBe('gate');
  });

  it('a restricted user who signs out and in again is still restricted (the server decides)', async () => {
    const w = makeWorld();
    server(w, restrictedStatus);
    await w.gate.start();
    await loginAs(w);
    await w.session.logout();
    await settle();
    expect(w.gate.getView().phase).toBe('signed_out');
    expect(w.lock.state).toBe('gate');
    await loginAs(w);
    expect(w.gate.getView().phase).toBe('restricted');
  });

  it('GC9: an administrator is released without a challenge and /gate/* is never called', async () => {
    const w = makeWorld();
    installAuthRoutes(w, { role: 'administrator' });
    await w.gate.start();
    await loginAs(w);
    expect(w.gate.getView()).toMatchObject({ phase: 'granted', admin: true, autoContinue: false });
    expect(w.fakeApi.requests.filter((r) => r.path.startsWith('/gate'))).toHaveLength(0);
    expect(w.gate.continue().ok).toBe(true);
    expect(w.lock.state).toBe('unlocked');
  });

  it('GC10 (S18): quit and close are refused while locked, except OS logoff or shutdown', async () => {
    const w = makeWorld();
    server(w);
    await w.gate.start();
    expect(w.lock.canQuit()).toBe(false);
    expect(w.window.tryClose()).toBe(true); // Alt+F4 / window.close(): prevented
    expect(w.window.press({ key: 'F4', alt: true })).toBe(true);
    expect(w.window.press({ key: 'w', control: true })).toBe(true);
    // The OS is logging off / shutting down: never blocked.
    w.power.fire('shutdown');
    expect(w.lock.canQuit()).toBe(true);
    expect(w.window.tryClose()).toBe(false);
  });

  it('GC10b: window session-end (Windows logoff) also unblocks quitting', async () => {
    const w = makeWorld();
    server(w);
    await w.gate.start();
    w.window.endSession();
    expect(w.lock.canQuit()).toBe(true);
  });

  it('after release the window can be closed again', async () => {
    const w = makeWorld();
    await toReleased(w);
    expect(w.lock.canQuit()).toBe(true);
    expect(w.window.tryClose()).toBe(false);
  });

  it('GC11: a re-lock never interrupts an active lockdown; it happens after lockdown exits', async () => {
    const w = makeWorld();
    const until = new Date(Date.now() + 10 * 60_000).toISOString();
    const state = await toReleased(w, until);
    state.status = requiredStatus;
    w.fakeApi.on('POST /modules/' + OID.module1 + '/quiz/sessions', jsonReply(201, sessionDto()));
    w.fakeApi.on(
      'POST /modules/' + OID.module1 + '/quiz/sessions/' + OID.session1 + '/abandon',
      jsonReply(201, attemptDto('abandoned', 0)),
    );
    const started = await w.lockdown.startSecure({ kind: 'quiz', moduleId: OID.module1 });
    expect(started.ok).toBe(true);
    expect(w.lock.state).toBe('lockdown');

    await advance(11 * 60_000); // clearance expires mid-quiz
    expect(w.lock.state).toBe('lockdown');
    expect(w.gate.getView().phase).toBe('released');

    const exit = await w.lockdown.exit({ sessionId: OID.session1 });
    expect(exit.ok).toBe(true);
    await settle();
    expect(w.lock.state).toBe('gate');
    expect(w.gate.getView().phase).toBe('challenge');
  });

  it('a session that ends while released re-locks to Login', async () => {
    const w = makeWorld();
    await toReleased(w);
    w.fakeApi.on('GET /modules', apiError(401, 'UNAUTHENTICATED'));
    w.fakeApi.on('POST /auth/refresh', apiError(401, 'INVALID_REFRESH_TOKEN'));
    const { OPERATIONS } = await import('../api/operations');
    await w.api.call(OPERATIONS['modules.list']);
    await settle();
    expect(w.lock.state).toBe('gate');
    expect(w.gate.getView().phase).toBe('signed_out');
    expect(w.session.getView().endedNotice).toBe('session_ended');
  });

  it('a start-up with no network and no persisted session shows Login, not offline', async () => {
    const w = makeWorld();
    w.fakeApi.on('GET /gate/status', { status: 0, throws: true });
    await w.gate.start();
    expect(w.gate.getView().phase).toBe('signed_out');
  });

  it('views never carry tokens or key material', async () => {
    const w = makeWorld();
    await toChallenge(w);
    expect(JSON.stringify(w.gateViews)).not.toMatch(
      /token-\d|accessToken|refreshToken|correct(Answer|Index)/i,
    );
  });

  it('P5-I4: an expired challenge (409 stale, status now required) recovers to a fresh question', async () => {
    const w = makeWorld();
    const state = await toChallenge(w);
    // The server expired the challenge: the answer is refused, the gate is back to "required", and
    // the next challenge request serves a new question on the same run.
    state.status = requiredStatus;
    state.nextChallenge = challengeStatus(3, OID.challenge2);
    w.fakeApi.on('POST /gate/attempts', apiError(409, 'GATE_CHALLENGE_STALE'));
    const res = await w.gate.submitAnswer({ challengeId: OID.challenge1, optionIndex: 0 });
    expect(res).toMatchObject({ ok: false, error: { code: 'GATE_CHALLENGE_STALE' } });
    await settle();
    expect(w.gate.getView()).toMatchObject({
      phase: 'challenge',
      attemptsRemaining: 3,
      challenge: { challengeId: OID.challenge2 },
    });
    expect(w.lock.state).toBe('gate');
  });
});
