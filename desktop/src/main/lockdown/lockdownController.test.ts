import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MainEvent } from '../../shared/ipcChannels';
import { apiError, jsonReply } from '../testing/fakes';
import { FAKE_TIMERS, advance, settle, toReleased } from '../testing/helpers';
import {
  OID,
  PENDING_FILE,
  attemptDto,
  loginBody,
  makeWorld,
  sessionDto,
  type World,
} from '../testing/world';

const START = `POST /modules/${OID.module1}/quiz/sessions`;
const ABANDON = `POST /modules/${OID.module1}/quiz/sessions/${OID.session1}/abandon`;
const SUBMIT = `POST /modules/${OID.module1}/quiz/attempts`;
const QUIZ = { kind: 'quiz', moduleId: OID.module1 } as const;

beforeEach(() => {
  vi.useFakeTimers({ toFake: [...FAKE_TIMERS] });
});
afterEach(() => {
  vi.useRealTimers();
});

async function released(): Promise<World> {
  const w = makeWorld();
  await toReleased(w);
  w.fakeApi.on(START, () => jsonReply(201, sessionDto(OID.session1)));
  w.fakeApi.on(ABANDON, () => jsonReply(201, attemptDto('abandoned', 0)));
  return w;
}

async function active(): Promise<World> {
  const w = await released();
  const res = await w.lockdown.startSecure(QUIZ);
  expect(res.ok).toBe(true);
  w.events.length = 0;
  return w;
}

const lockdownEvents = (w: World) =>
  w.events.filter((e): e is Extract<MainEvent, { type: 'lockdown' }> => e.type === 'lockdown');

describe('LockdownController', () => {
  it('LC1 (S17): lockdown is entered only through startSecure; questions arrive only once active', async () => {
    const w = await released();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    w.fakeApi.on(START, () => ({ status: 201, gate, body: sessionDto(OID.session1) }));

    const p = w.lockdown.startSecure(QUIZ);
    await settle();
    // Entering: window already locked down, questions NOT yet handed out.
    expect(w.lockdown.getState()).toBe('entering');
    expect(w.lock.state).toBe('lockdown');
    expect(w.lockdown.resume()).toBeNull();
    release();
    const res = await p;
    expect(res).toMatchObject({
      ok: true,
      data: { resumed: false, remainingFocusLosses: 3, session: { sessionId: OID.session1 } },
    });
    expect(w.lockdown.getState()).toBe('active');
    expect(lockdownEvents(w).map((e) => e.state)).toEqual(['entering', 'active']);
  });

  it('LC1b: refused (and nothing requested) while the gate has not released the workstation', async () => {
    const w = makeWorld();
    w.fakeApi.on(START, () => jsonReply(201, sessionDto()));
    const res = await w.lockdown.startSecure(QUIZ);
    expect(res).toMatchObject({ ok: false, error: { code: 'GATE_LOCKED' } });
    expect(w.fakeApi.count(START)).toBe(0);
    expect(w.lock.state).toBe('unlocked');
  });

  it('LC1c: a second start while one is running is refused and does not touch the first', async () => {
    const w = await active();
    const res = await w.lockdown.startSecure(QUIZ);
    expect(res).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(w.fakeApi.count(START)).toBe(1);
    expect(w.lockdown.getState()).toBe('active');
  });

  it('LC1d: the final assessment uses its own routes', async () => {
    const w = await released();
    w.fakeApi.on('POST /final-test/sessions', () =>
      jsonReply(201, { ...sessionDto(OID.session2), kind: 'FinalTest', moduleId: null }),
    );
    expect((await w.lockdown.startSecure({ kind: 'final' })).ok).toBe(true);
    w.fakeApi.on('POST /final-test/attempts', () => jsonReply(201, attemptDto('submitted', 90)));
    const res = await w.lockdown.submit({ sessionId: OID.session2, answers: [] });
    expect(res.ok).toBe(true);
    expect(w.fakeApi.count('POST /final-test/attempts')).toBe(1);
  });

  it('LC2: an error on start leaves the workstation unlocked, with retryAt for a cooldown', async () => {
    const w = await released();
    w.fakeApi.on(
      START,
      apiError(409, 'ASSESSMENT_COOLDOWN', {
        details: { retryAt: '2026-11-10T12:30:00.000Z' },
        headers: { 'retry-after': '600' },
      }),
    );
    const res = await w.lockdown.startSecure(QUIZ);
    expect(res).toMatchObject({
      ok: false,
      error: {
        code: 'ASSESSMENT_COOLDOWN',
        retryAfterSeconds: 600,
        details: { retryAt: '2026-11-10T12:30:00.000Z' },
      },
    });
    expect(w.lock.state).toBe('unlocked');
    expect(w.window.kiosk).toBe(false);
    expect(w.window.contentProtected).toBe(false);
    expect(
      lockdownEvents(w)
        .map((e) => e.state)
        .slice(-3),
    ).toEqual(['entering', 'failed', 'inactive']);
    expect(w.lockdown.resume()).toBeNull();
  });

  it('LC3 (S17): submit, exit and resume only honour the session main started', async () => {
    const w = await active();
    const foreign = OID.session2;
    expect(await w.lockdown.submit({ sessionId: foreign, answers: [] })).toMatchObject({
      ok: false,
      error: { code: 'LOCKDOWN_NOT_ACTIVE' },
    });
    expect(await w.lockdown.exit({ sessionId: foreign })).toMatchObject({
      ok: false,
      error: { code: 'LOCKDOWN_NOT_ACTIVE' },
    });
    expect(w.fakeApi.count(SUBMIT)).toBe(0);
    expect(w.fakeApi.count(ABANDON)).toBe(0);
    expect(w.lockdown.getState()).toBe('active');
    expect(w.lockdown.resume()?.session.sessionId).toBe(OID.session1);
    // With no lockdown at all, everything is refused.
    const idle = await released();
    expect(await idle.lockdown.submit({ sessionId: OID.session1, answers: [] })).toMatchObject({
      ok: false,
      error: { code: 'LOCKDOWN_NOT_ACTIVE' },
    });
  });

  it('LC4 (S20): exit unlocks locally BEFORE the network call, then abandons', async () => {
    const w = await active();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const snapshots: { kiosk: boolean; state: string; abandonSeen: number }[] = [];
    w.fakeApi.on(ABANDON, () => {
      snapshots.push({
        kiosk: w.window.kiosk,
        state: w.lockdown.getState(),
        abandonSeen: w.fakeApi.count(ABANDON),
      });
      return { status: 201, gate, body: attemptDto('abandoned', 0) };
    });
    const p = w.lockdown.exit({ sessionId: OID.session1 });
    expect(w.lockdown.getState()).toBe('inactive'); // synchronous, before any await
    expect(w.window.kiosk).toBe(false);
    expect(w.lock.state).toBe('unlocked');
    await settle();
    release();
    const res = await p;
    expect(snapshots[0]).toMatchObject({ kiosk: false, state: 'inactive' });
    expect(res).toMatchObject({ ok: true, data: { attempt: { endReason: 'abandoned' } } });
    expect(w.fs.files.has(PENDING_FILE)).toBe(false);
  });

  it('LC4b: if the abandon never reaches the server, a pending record (ids only) is kept and retried later', async () => {
    const w = await active();
    w.fakeApi.on(ABANDON, { status: 0, throws: true });
    const p = w.lockdown.exit({ sessionId: OID.session1 });
    await advance(6000);
    const res = await p;
    expect(res).toMatchObject({ ok: true, data: { attempt: null } });
    expect(w.lock.state).toBe('unlocked'); // never a trap
    const pending = JSON.parse(w.fs.text(PENDING_FILE) ?? 'null') as unknown;
    expect(pending).toEqual([
      { userId: OID.user, kind: 'quiz', moduleId: OID.module1, sessionId: OID.session1 },
    ]);
    expect(w.fs.text(PENDING_FILE)).not.toMatch(/token|answer|question/i);
    await advance(10_000);
    expect(w.fakeApi.count(ABANDON)).toBe(4); // first try + 3 backoff retries

    w.fakeApi.on(ABANDON, apiError(409, 'SESSION_CLOSED'));
    await w.lockdown.retryPending();
    expect(w.fs.files.has(PENDING_FILE)).toBe(false);
  });

  it('LC4c: pending abandons survive a restart', async () => {
    const w = await active();
    w.fakeApi.on(ABANDON, { status: 0, throws: true });
    const p = w.lockdown.exit({ sessionId: OID.session1 });
    await advance(6000);
    await p;
    const w2 = makeWorld();
    w2.fs.files = new Map(w.fs.files);
    await w2.lockdown.loadPending();
    expect(w2.lockdown.getPending()).toEqual([
      { userId: OID.user, kind: 'quiz', moduleId: OID.module1, sessionId: OID.session1 },
    ]);
  });

  it('LC5: the clipboard is cleared on entry and again on exit', async () => {
    const w = await released();
    w.clipboard.text = 'secret text copied before the quiz';
    await w.lockdown.startSecure(QUIZ);
    expect(w.clipboard.text).toBe('');
    w.clipboard.text = 'something placed during the quiz';
    await w.lockdown.exit({ sessionId: OID.session1 });
    expect(w.clipboard.text).toBe('');
    expect(w.clipboard.clears).toBeGreaterThanOrEqual(2);
  });

  it('LC6: content protection is on during lockdown and off afterwards; the window is kiosk and on top', async () => {
    const w = await active();
    expect(w.window).toMatchObject({
      contentProtected: true,
      kiosk: true,
      fullScreen: true,
      alwaysOnTop: true,
      closable: false,
      minimizable: false,
      movable: false,
      skipTaskbar: true,
    });
    await w.lockdown.exit({ sessionId: OID.session1 });
    expect(w.window).toMatchObject({
      contentProtected: false,
      kiosk: false,
      alwaysOnTop: false,
      closable: true,
      minimizable: true,
      movable: true,
      skipTaskbar: false,
    });
  });

  it('LC7: PrintScreen is registered while active and released on exit', async () => {
    const w = await active();
    expect(w.shortcut.registered.has('PrintScreen')).toBe(true);
    await w.lockdown.exit({ sessionId: OID.session1 });
    expect(w.shortcut.registered.size).toBe(0);
  });

  it('LC8: devtools opening is closed at once and reported; the devtools keys are blocked', async () => {
    const w = await active();
    w.window.openDevTools();
    expect(w.window.devToolsOpen).toBe(false);
    expect(w.events.find((e) => e.type === 'lockdown-violation')).toMatchObject({
      kind: 'devtools',
      remaining: 3,
    });
    expect(w.window.press({ key: 'F12' })).toBe(true);
    expect(w.window.press({ key: 'I', control: true, shift: true })).toBe(true);
  });

  it('LC8b: blocked keys surface a throttled notice; allowed keys do not', async () => {
    const w = await active();
    w.window.press({ key: 'Tab' });
    w.window.press({ key: 'Escape' });
    expect(w.events.filter((e) => e.type === 'lockdown-violation')).toHaveLength(0);
    w.window.press({ key: 'c', control: true });
    w.window.press({ key: 'v', control: true });
    w.window.press({ key: 'F5' });
    const notices = w.events.filter((e) => e.type === 'lockdown-violation');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: 'blocked_shortcut' });
    await advance(2100);
    w.window.press({ key: 'p', control: true });
    expect(w.events.filter((e) => e.type === 'lockdown-violation')).toHaveLength(2);
  });

  describe('LC9: focus loss policy (D5-15)', () => {
    it('a blur under 500 ms is ignored', async () => {
      const w = await active();
      w.window.doBlur();
      await advance(300);
      w.window.doFocus();
      await advance(1000);
      expect(w.events.filter((e) => e.type === 'lockdown-violation')).toHaveLength(0);
      expect(w.lockdown.getState()).toBe('active');
    });

    it('warns and refocuses on each loss, then abandons on the 3rd', async () => {
      const w = await active();
      const lose = async () => {
        w.window.doBlur();
        await advance(600);
        w.window.doFocus();
      };
      await lose();
      expect(w.events.filter((e) => e.type === 'lockdown-violation').at(-1)).toMatchObject({
        kind: 'focus_lost',
        count: 1,
        remaining: 2,
      });
      expect(w.window.log).toContain('moveTop');
      expect(w.window.log).toContain('flash:true');
      expect(w.lockdown.getState()).toBe('active');
      await lose();
      expect(w.events.filter((e) => e.type === 'lockdown-violation').at(-1)).toMatchObject({
        count: 2,
        remaining: 1,
      });
      expect(w.lockdown.getState()).toBe('active');
      expect(w.lockdown.resume()?.remainingFocusLosses).toBe(1);

      await lose();
      expect(w.lockdown.getState()).toBe('inactive');
      expect(w.lock.state).toBe('unlocked');
      expect(lockdownEvents(w).at(-1)).toMatchObject({ state: 'inactive', reason: 'focus_lost' });
      expect(w.fakeApi.count(ABANDON)).toBe(1);
    });

    it('abandons when focus stays away for more than 15 s', async () => {
      const w = await active();
      w.window.doBlur();
      await advance(14_000);
      expect(w.lockdown.getState()).toBe('active');
      await advance(2000);
      expect(w.lockdown.getState()).toBe('inactive');
      expect(lockdownEvents(w).at(-1)).toMatchObject({ reason: 'focus_lost' });
      expect(w.fakeApi.count(ABANDON)).toBe(1);
    });

    it('is not armed outside lockdown', async () => {
      const w = await released();
      w.window.doBlur();
      await advance(60_000);
      expect(w.fakeApi.count(ABANDON)).toBe(0);
      expect(w.events.filter((e) => e.type === 'lockdown-violation')).toHaveLength(0);
    });
  });

  it('LC10 (D5-16): the first renderer crash reloads and resumes; the second exits', async () => {
    const w = await active();
    w.window.crash();
    expect(w.window.reloads).toBe(1);
    expect(w.lock.state).toBe('lockdown'); // still locked
    expect(w.lockdown.resume()).toMatchObject({
      resumed: true,
      session: { sessionId: OID.session1 },
    });
    // The cached session carries questions but no keys.
    expect(JSON.stringify(w.lockdown.resume())).not.toMatch(/correct/i);

    w.window.crash();
    await settle();
    expect(w.lockdown.getState()).toBe('inactive');
    expect(w.lock.state).toBe('unlocked');
    expect(w.window.reloads).toBe(2);
    expect(lockdownEvents(w).at(-1)).toMatchObject({ reason: 'crash' });
    expect(w.fakeApi.count(ABANDON)).toBe(1);
  });

  it('a clean renderer exit is not treated as a crash', async () => {
    const w = await active();
    w.window.crash('clean-exit');
    expect(w.window.reloads).toBe(0);
    expect(w.lockdown.getState()).toBe('active');
  });

  it('LC11: an unresponsive renderer for 10 s is forcefully crashed; a recovery cancels that', async () => {
    const w = await active();
    w.window.hang();
    await advance(9000);
    expect(w.window.crashes).toBe(0);
    await advance(2000);
    expect(w.window.crashes).toBe(1);

    const w2 = await active();
    w2.window.hang();
    await advance(5000);
    w2.window.recover();
    await advance(20_000);
    expect(w2.window.crashes).toBe(0);
  });

  it('LC12: the hard cap ends lockdown at expiresAt + 60 s whatever the renderer does', async () => {
    const w = await released();
    w.fakeApi.on(START, () => jsonReply(201, sessionDto(OID.session1, 10 * 60_000)));
    await w.lockdown.startSecure(QUIZ);
    await advance(10 * 60_000 + 59_000);
    expect(w.lockdown.getState()).toBe('active');
    await advance(2000);
    expect(w.lockdown.getState()).toBe('inactive');
    expect(w.lock.state).toBe('unlocked');
    expect(lockdownEvents(w).at(-1)).toMatchObject({ reason: 'hard_cap' });
  });

  it('LC13: unlock is idempotent', async () => {
    const w = await active();
    await w.lockdown.exit({ sessionId: OID.session1 });
    const before = w.window.log.length;
    w.lock.unlock();
    w.lock.unlock();
    expect(w.window.log.length).toBe(before);
    expect(w.lock.state).toBe('unlocked');
  });

  describe('LC14: submit', () => {
    it('a graded submission exits lockdown and returns the server result', async () => {
      const w = await active();
      w.fakeApi.on(SUBMIT, (req) => {
        expect(req.body).toEqual({
          sessionId: OID.session1,
          answers: [
            { questionId: OID.q1, selectedIndex: 1 },
            { questionId: OID.q2, selectedIndex: null },
          ],
        });
        return jsonReply(201, attemptDto('submitted', 100));
      });
      const res = await w.lockdown.submit({
        sessionId: OID.session1,
        answers: [
          { questionId: OID.q1, selectedIndex: 1 },
          { questionId: OID.q2, selectedIndex: null },
        ],
      });
      expect(res).toMatchObject({ ok: true, data: { score: 100, passed: true } });
      expect(w.lock.state).toBe('unlocked');
      expect(lockdownEvents(w).at(-1)).toMatchObject({ state: 'inactive', reason: 'submitted' });
      expect(w.fakeApi.count(ABANDON)).toBe(0);
    });

    it('a network failure stays in lockdown so the renderer can retry (or exit)', async () => {
      const w = await active();
      w.fakeApi.on(SUBMIT, { status: 0, throws: true });
      const res = await w.lockdown.submit({ sessionId: OID.session1, answers: [] });
      expect(res).toMatchObject({ ok: false, error: { code: 'NETWORK_UNAVAILABLE' } });
      expect(w.lockdown.getState()).toBe('active');
      expect(w.lock.state).toBe('lockdown');
      // Exit stays available.
      expect((await w.lockdown.exit({ sessionId: OID.session1 })).ok).toBe(true);
    });

    it('terminal 409s exit lockdown (closed, expired, cooldown)', async () => {
      for (const code of ['SESSION_CLOSED', 'SESSION_EXPIRED', 'ASSESSMENT_COOLDOWN']) {
        const w = await active();
        w.fakeApi.on(SUBMIT, apiError(409, code));
        const res = await w.lockdown.submit({ sessionId: OID.session1, answers: [] });
        expect(res, code).toMatchObject({ ok: false, error: { code } });
        expect(w.lock.state, code).toBe('unlocked');
      }
    });

    it('a session that ended mid-quiz leaves lockdown and sends no abandon', async () => {
      const w = await active();
      w.fakeApi.on(SUBMIT, apiError(401, 'UNAUTHENTICATED'));
      w.fakeApi.on('POST /auth/refresh', apiError(401, 'INVALID_REFRESH_TOKEN'));
      const res = await w.lockdown.submit({ sessionId: OID.session1, answers: [] });
      expect(res).toMatchObject({ ok: false, error: { code: 'NOT_SIGNED_IN' } });
      expect(w.lockdown.getState()).toBe('inactive');
      expect(w.fakeApi.count(ABANDON)).toBe(0);
      await settle();
      // The queued gate re-lock takes over once lockdown has exited and shows Login.
      expect(w.lock.state).toBe('gate');
      expect(w.gate.getView().phase).toBe('signed_out');
    });
  });

  it('keeps the access token fresh while locked down and stops afterwards', async () => {
    const w = await active();
    await advance(900_000 - 120_000 + 2000);
    expect(w.fakeApi.count('POST /auth/refresh')).toBe(1);
    await w.lockdown.exit({ sessionId: OID.session1 });
    const refreshes = w.fakeApi.count('POST /auth/refresh');
    await advance(3_600_000);
    expect(w.fakeApi.count('POST /auth/refresh')).toBe(refreshes);
  });

  it('sign-out during lockdown leaves it first', async () => {
    const w = await active();
    w.lockdown.leaveForSignOut();
    expect(w.lock.state).toBe('unlocked');
    await w.session.logout();
    await settle();
    expect(w.gate.getView().phase).toBe('signed_out');
    expect(w.lock.state).toBe('gate');
  });

  it('P5-I5: pending abandons are bound to their user and never replayed for another', async () => {
    const w = await active();
    w.fakeApi.on(ABANDON, { status: 0, throws: true });
    const p = w.lockdown.exit({ sessionId: OID.session1 });
    await advance(6000);
    await p;
    expect(w.lockdown.getPending()[0]?.userId).toBe(OID.user);

    // Another user signs in on the same machine: the first user's entry is skipped.
    w.fakeApi.on(ABANDON, jsonReply(201, attemptDto('abandoned', 0)));
    const before = w.fakeApi.count(ABANDON);
    const other = makeWorld();
    other.fs.files = new Map(w.fs.files);
    await other.lockdown.loadPending();
    other.fakeApi.on(
      'POST /auth/login',
      jsonReply(200, {
        ...loginBody(1),
        user: { id: 'f'.repeat(24), name: 'B', role: 'employee' },
      }),
    );
    await other.session.login({ email: 'b@example.com', password: 'x' });
    other.fakeApi.on(ABANDON, jsonReply(201, attemptDto('abandoned', 0)));
    await other.lockdown.retryPending();
    expect(other.fakeApi.count(ABANDON)).toBe(0);
    expect(other.lockdown.getPending()).toHaveLength(1);
    expect(w.fakeApi.count(ABANDON)).toBe(before);
  });

  it('entries without a user (written by an older build) are discarded on load', async () => {
    const w = makeWorld();
    w.fs.files.set(
      PENDING_FILE,
      Buffer.from(
        JSON.stringify([{ kind: 'quiz', moduleId: OID.module1, sessionId: OID.session1 }]),
      ),
    );
    await w.lockdown.loadPending();
    expect(w.lockdown.getPending()).toHaveLength(0);
  });

  it('P5-L7: parking an active quiz for a restart records a pending abandon first', async () => {
    const w = await active();
    await w.lockdown.parkActiveForRestart();
    expect(w.lockdown.getPending()).toEqual([
      { userId: OID.user, kind: 'quiz', moduleId: OID.module1, sessionId: OID.session1 },
    ]);
    expect(w.fs.text(PENDING_FILE)).toContain(OID.session1);
    // Nothing active: nothing to park.
    const idle = await released();
    await idle.lockdown.parkActiveForRestart();
    expect(idle.lockdown.getPending()).toHaveLength(0);
  });
});
