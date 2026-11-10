import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonReply } from '../testing/fakes';
import { FAKE_TIMERS, advance, loginAs, server, settle } from '../testing/helpers';
import {
  GATE_STATE_FILE,
  OFFLINE_REPORTS_FILE,
  OID,
  challengeStatus,
  grantedStatus,
  farFuture,
  installAuthRoutes,
  makeWorld,
  requiredStatus,
  restrictedStatus,
  type World,
} from '../testing/world';

beforeEach(() => {
  vi.useFakeTimers({ toFake: [...FAKE_TIMERS] });
});
afterEach(() => {
  vi.useRealTimers();
});

function relaunch(prev: World): World {
  const w = makeWorld();
  for (const [k, v] of prev.fs.files) w.fs.files.set(k, v);
  return w;
}

async function startOffline(w: World): Promise<void> {
  installAuthRoutes(w);
  w.fakeApi.on('POST /auth/refresh', { status: 0, throws: true });
  w.fakeApi.on('GET /gate/status', { status: 0, throws: true });
  await w.gate.start();
  await settle();
  expect(w.gate.getView().phase).toBe('offline');
}

describe('P5-M1: last known gate state', () => {
  it('is stored encrypted: no plaintext state, user id or token on disk', async () => {
    const w = makeWorld();
    server(w, restrictedStatus);
    await w.gate.start();
    await loginAs(w);
    const raw = w.fs.text(GATE_STATE_FILE) ?? '';
    expect(raw).not.toBe('');
    expect(raw).not.toMatch(/restricted|granted|required|userId|aaaaaaaa|token/i);
    expect(Object.keys(JSON.parse(raw) as object).sort()).toEqual(['blob', 'v']);
  });

  it('with OS encryption unavailable nothing is written (memory only)', async () => {
    const w = makeWorld();
    w.safeStorage.available = false;
    server(w, restrictedStatus);
    await w.gate.start();
    await loginAs(w);
    expect(w.fs.files.has(GATE_STATE_FILE)).toBe(false);
    // In the same process the restriction is still remembered.
    expect(w.gateState.get(OID.user)?.state).toBe('restricted');
  });

  it('a restricted user is never offered Continue offline, however long the outage', async () => {
    const first = makeWorld();
    server(first, restrictedStatus);
    await first.gate.start();
    await loginAs(first);
    const w = relaunch(first);
    await startOffline(w);
    await advance(3_600_000);
    expect(w.gate.getView().offline).toMatchObject({
      graceElapsed: true,
      canContinueOffline: false,
    });
    expect(w.gate.continueOffline().ok).toBe(false);
    expect(w.lock.state).toBe('gate');
  });

  it('with no stored state (first run on this machine) D5-12 applies: fail open after the grace period', async () => {
    const first = makeWorld();
    server(first, grantedStatus(farFuture()));
    await first.gate.start();
    await loginAs(first);
    first.fs.files.delete(GATE_STATE_FILE); // as if the state had never been recorded
    const w = relaunch(first);
    await startOffline(w);
    await advance(121_000);
    expect(w.gate.getView().offline?.canContinueOffline).toBe(true);
    expect(w.gate.continueOffline().ok).toBe(true);
    expect(w.lock.state).toBe('unlocked');
  });

  it('a user whose last state was required/granted may continue offline', async () => {
    for (const status of [requiredStatus, grantedStatus(farFuture()), challengeStatus(2)]) {
      const first = makeWorld();
      server(first, status);
      await first.gate.start();
      await loginAs(first);
      const w = relaunch(first);
      await startOffline(w);
      await advance(121_000);
      expect(w.gate.continueOffline().ok, status.state).toBe(true);
    }
  });

  it('the stored state belongs to one user: another user on the machine is not blocked by it', async () => {
    const w = makeWorld();
    await w.gateState.record('someone-else', 'restricted', null);
    expect(w.gateState.get(OID.user)).toBeNull();
    expect(w.gateState.get('someone-else')?.state).toBe('restricted');
  });

  it('a corrupt state file is deleted and reads as empty', async () => {
    const w = makeWorld();
    w.fs.files.set(GATE_STATE_FILE, Buffer.from('{"v":1,"blob":"AAAA"}'));
    await w.gateState.load();
    expect(w.gateState.get(OID.user)).toBeNull();
    expect(w.fs.files.has(GATE_STATE_FILE)).toBe(false);
  });

  it('every response updates it: restricted -> restored -> required', async () => {
    const w = makeWorld();
    const state = server(w, restrictedStatus);
    await w.gate.start();
    await loginAs(w);
    expect(w.gateState.get(OID.user)?.state).toBe('restricted');
    state.status = requiredStatus;
    await advance(61_000);
    expect(w.gateState.get(OID.user)?.state).toBe('required');
  });
});

describe('P5-M1: offline releases are reported', () => {
  async function releasedOffline(): Promise<World> {
    const first = makeWorld();
    server(first, requiredStatus);
    await first.gate.start();
    await loginAs(first);
    const w = relaunch(first);
    await startOffline(w);
    await advance(121_000);
    expect(w.gate.continueOffline().ok).toBe(true);
    await settle();
    return w;
  }

  it('queues an encrypted report at release and sends it once the API answers (at least once)', async () => {
    const w = await releasedOffline();
    const raw = w.fs.text(OFFLINE_REPORTS_FILE) ?? '';
    expect(raw).not.toBe('');
    expect(raw).not.toMatch(/releasedAt|api_unreachable|userId/);
    expect(w.offlineReports.pending()).toHaveLength(1);
    const releasedAt = w.offlineReports.pending()[0]?.releasedAt ?? '';

    const bodies: unknown[] = [];
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
    w.fakeApi.on('GET /gate/status', jsonReply(200, requiredStatus));
    w.fakeApi.on('POST /gate/challenge', jsonReply(200, challengeStatus(3)));
    w.fakeApi.on('POST /gate/offline-releases', (req) => {
      bodies.push(req.body);
      return jsonReply(201, { recorded: true, duplicate: false, escalated: false });
    });
    await advance(16_000);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ releasedAt, reason: 'api_unreachable' });
    expect(typeof (bodies[0] as { durationSeconds: number }).durationSeconds).toBe('number');
    expect(w.offlineReports.pending()).toHaveLength(0);
    expect(w.fs.files.has(OFFLINE_REPORTS_FILE)).toBe(false);
    // The API answered with no clearance: the workstation is covered again.
    expect(w.lock.state).toBe('gate');
  });

  it('a failed delivery stays queued and is retried with the same releasedAt (idempotent)', async () => {
    const w = await releasedOffline();
    const releasedAt = w.offlineReports.pending()[0]?.releasedAt ?? '';
    const seen: string[] = [];
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
    let fail = true;
    w.fakeApi.on('POST /gate/offline-releases', (req) => {
      seen.push((req.body as { releasedAt: string }).releasedAt);
      return fail
        ? { status: 503, body: { error: { code: 'INTERNAL_ERROR', message: 'x' } } }
        : jsonReply(200, { recorded: true, duplicate: true, escalated: false });
    });
    await advance(16_000);
    expect(w.offlineReports.pending()).toHaveLength(1); // kept
    fail = false;
    await w.offlineReports.flush(OID.user);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(new Set(seen)).toEqual(new Set([releasedAt]));
    expect(w.offlineReports.pending()).toHaveLength(0);
  });

  it('survives a restart and is never sent under another user', async () => {
    const w = await releasedOffline();
    const w2 = relaunch(w);
    await w2.offlineReports.load();
    expect(w2.offlineReports.pending()).toHaveLength(1);
    const sent: unknown[] = [];
    installAuthRoutes(w2);
    w2.fakeApi.on('POST /gate/offline-releases', (req) => {
      sent.push(req.body);
      return jsonReply(201, { recorded: true, duplicate: false, escalated: false });
    });
    await w2.offlineReports.flush('another-user-id');
    expect(sent).toHaveLength(0);
    expect(w2.offlineReports.pending()).toHaveLength(1);
  });

  it('a report the server refuses as malformed is dropped, not retried forever', async () => {
    const w = await releasedOffline();
    installAuthRoutes(w);
    w.fakeApi.on('POST /gate/offline-releases', {
      status: 400,
      body: { error: { code: 'VALIDATION_ERROR', message: 'x' } },
    });
    await w.tokens.set({
      userId: OID.user,
      accessToken: 'a',
      accessExpiresAt: Date.now() + 900_000,
      refreshToken: 'r',
      refreshExpiresAt: Date.now() + 1e9,
    });
    await w.offlineReports.flush(OID.user);
    expect(w.offlineReports.pending()).toHaveLength(0);
  });
});
