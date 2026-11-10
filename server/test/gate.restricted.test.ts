import { Types } from 'mongoose';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { allRoutes } from '../src/routes.js';
import { AuditLog, Escalation, GateRun } from '../src/models/index.js';
import { bearer, loginOk, makeCredentials } from './helpers/fixtures.js';
import {
  buildGateApp,
  createGateQuestions,
  escalationFor,
  failGate,
  gateEmployee,
  gateFlag,
  getStatus,
  openChallenge,
  postChallenge,
  type GateApp,
} from './helpers/gateFixtures.js';
import { syncLearningIndexes } from './helpers/learningFixtures.js';
import { auditEntriesFor, verifyAuditChain } from './helpers/riskFixtures.js';

let creds: Awaited<ReturnType<typeof makeCredentials>>;
let t: GateApp;

beforeAll(async () => {
  creds = await makeCredentials();
  await syncLearningIndexes();
});

beforeEach(async () => {
  t = await buildGateApp();
  await createGateQuestions(8);
});

describe('gate restriction', () => {
  it('GT6: three wrong answers restrict the run, open one critical security-team escalation and audit it', async () => {
    const e = await gateEmployee(t.app, creds);
    const result = await failGate(t.app, e);
    const status = result.status;
    expect(status.state).toBe('restricted');
    expect(status.attemptsRemaining).toBe(0);
    expect(status.challenge).toBeNull();
    expect(status.restricted?.referenceId).toMatch(/^GATE-20260310-[0-9A-F]{6}$/);

    const run = await GateRun.findOne({ userId: e.id }).lean();
    expect(run).toMatchObject({ status: 'restricted', attemptsUsed: 3, current: null });
    expect(
      status.restricted?.referenceId.endsWith(run?._id.toHexString().slice(-6).toUpperCase() ?? ''),
    ).toBe(true);

    const escalations = await Escalation.find({ userId: e.id }).lean();
    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toMatchObject({
      reason: 'gate_access_restricted',
      severity: 'critical',
      reviewTier: 'security_team',
      status: 'open',
    });
    expect(escalations[0]?.sourceRef.type).toBe('gate_event');
    expect(escalations[0]?.sourceRef.id.toHexString()).toBe(run?._id.toHexString());
    expect(run?.escalationId?.toHexString()).toBe(escalations[0]?._id.toHexString());
    expect(t.notifier.escalationOpened).toHaveBeenCalledTimes(1);

    const onUser = await auditEntriesFor(e.id);
    expect(onUser.filter((a) => a.action === 'governance.critical_event_recorded')).toHaveLength(1);
    const onEsc = await auditEntriesFor(escalations[0]?._id.toHexString() ?? '');
    expect(onEsc.map((a) => a.action)).toEqual(['escalation.opened']);
    expect((await verifyAuditChain()).ok).toBe(true);

    const flag = await gateFlag(e.id);
    expect(flag?.runId.toHexString()).toBe(run?._id.toHexString());
  });

  it('GT6b: the reference id uses the organisation time zone', async () => {
    const zone = await buildGateApp({ gate: { orgTimeZone: 'Pacific/Kiritimati' } });
    const e = await gateEmployee(zone.app, creds);
    // 08:00Z is 22:00 on the 10th in UTC+14; five hours later it is already the 11th there.
    const result = await failGate(zone.app, e);
    expect(result.status.restricted?.referenceId).toMatch(/^GATE-20260310-/);
    const later = await buildGateApp({ gate: { orgTimeZone: 'Pacific/Kiritimati' } });
    later.advance(5 * 3_600_000);
    const e2 = await gateEmployee(later.app, creds);
    const result2 = await failGate(later.app, e2);
    expect(result2.status.restricted?.referenceId).toMatch(/^GATE-20260311-/);
  });

  it('GT7: every employee route outside the allowlist answers 403 ACCESS_RESTRICTED; the five allowed routes work', async () => {
    const e = await gateEmployee(t.app, creds);
    await failGate(t.app, e);

    const routes = allRoutes({ config: t.config, clock: t.clock, isReady: () => true });
    const dummy = new Types.ObjectId().toHexString();
    const concrete = (path: string): string => path.replace(/:[A-Za-z]+/g, dummy);
    const employeeReachable = routes.filter(
      (r) =>
        r.access.kind === 'authenticated' ||
        (r.access.kind === 'role' && r.access.roles.includes('employee')),
    );
    expect(employeeReachable.length).toBeGreaterThan(20);

    const allowed: string[] = [];
    for (const r of employeeReachable) {
      const res = await request(t.app)
        [r.method](`/api/v1${concrete(r.path)}`)
        .set(...bearer(e.token))
        .send({});
      if (res.status === 403 && res.body.error?.code === 'ACCESS_RESTRICTED') continue;
      allowed.push(`${r.method.toUpperCase()} ${r.path}`);
    }
    expect(allowed.sort()).toEqual(
      [
        'GET /auth/me',
        'GET /config/features',
        'GET /gate/status',
        'POST /gate/challenge',
        'POST /gate/offline-releases',
      ].sort(),
    );
    // And the declared allowlist is exactly that set.
    expect(
      routes
        .filter((r) => r.allowWhileRestricted)
        .map((r) => `${r.method.toUpperCase()} ${r.path}`)
        .sort(),
    ).toEqual(allowed.sort());

    expect(
      (
        await request(t.app)
          .get('/api/v1/auth/me')
          .set(...bearer(e.token))
      ).status,
    ).toBe(200);
    expect(
      (
        await request(t.app)
          .get('/api/v1/config/features')
          .set(...bearer(e.token))
      ).status,
    ).toBe(200);
    const status = await getStatus(t.app, e.token);
    expect(status.status).toBe(200);
    expect(status.body.state).toBe('restricted');
    const challenge = await postChallenge(t.app, e.token);
    expect(challenge.status).toBe(200);
    expect(challenge.body.state).toBe('restricted'); // opens nothing
    expect(await GateRun.countDocuments({ status: 'open' })).toBe(0);

    // A restricted employee cannot submit attempts either.
    const attempt = await request(t.app)
      .post('/api/v1/gate/attempts')
      .set(...bearer(e.token))
      .send({ challengeId: dummy, selectedIndex: 0 });
    expect(attempt.status).toBe(403);
    expect(attempt.body.error.code).toBe('ACCESS_RESTRICTED');
  });

  it('GT7b: restriction does not affect administrators or other employees', async () => {
    const e = await gateEmployee(t.app, creds);
    const other = await gateEmployee(t.app, creds);
    await failGate(t.app, e);
    expect(
      (
        await request(t.app)
          .get('/api/v1/modules')
          .set(...bearer(other.token))
      ).status,
    ).toBe(200);
    expect((await getStatus(t.app, other.token)).body.state).toBe('required');
  });

  it('GT8: logout and a new login keep the restriction', async () => {
    const e = await gateEmployee(t.app, creds);
    await failGate(t.app, e);
    const first = await loginOk(t.app, e);
    await request(t.app).post('/api/v1/auth/logout').send({ refreshToken: first.refreshToken });
    const second = await loginOk(t.app, e);
    const res = await request(t.app)
      .get('/api/v1/modules')
      .set(...bearer(second.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCESS_RESTRICTED');
    const status = await getStatus(t.app, second.accessToken);
    expect(status.body.state).toBe('restricted');
    expect(status.body.restricted.referenceId).toMatch(/^GATE-/);
    expect(await escalationFor(e.id)).not.toBeNull();
  });

  it('GT8b: a restart does not reset attempts: the run survives and is restricted exactly once', async () => {
    const e = await gateEmployee(t.app, creds);
    await failGate(t.app, e);
    const fresh = await buildGateApp(); // a restarted server with the same database
    const login = await loginOk(fresh.app, e);
    expect((await getStatus(fresh.app, login.accessToken)).body.state).toBe('restricted');
    expect(await openChallenge(fresh.app, login.accessToken)).toMatchObject({
      state: 'restricted',
    });
    expect(await Escalation.countDocuments({ userId: e.id })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'governance.critical_event_recorded' })).toBe(1);
  });
});
