/**
 * Phase 5 security review (security-tester): regression tests for the server gate, restricted
 * access and restore. Tests that expose a real defect are `it.fails` and name the finding ID; once
 * the defect is fixed they start failing and must become plain `it`.
 */
import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { audit } from '../src/features/audit/audit.service.js';
import { allRoutes } from '../src/routes.js';
import {
  AuditLog,
  Employee,
  GateAnswer,
  GateQuestion,
  GateRun,
  ReconcileMarker,
} from '../src/models/index.js';
import { bearer, loginOk, makeCredentials } from './helpers/fixtures.js';
import {
  HOUR_MS,
  answerRight,
  answerWrong,
  buildGateApp,
  createGateQuestions,
  escalationFor,
  failGate,
  gateAdmin,
  gateEmployee,
  gateFlag,
  getStatus,
  keyFor,
  openChallenge,
  parseResult,
  passGate,
  postAttempt,
  type GateApp,
  type GateEmployee,
} from './helpers/gateFixtures.js';
import { syncLearningIndexes } from './helpers/learningFixtures.js';
import { silentLogger, testConfig } from './helpers/testConfig.js';

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

afterEach(() => {
  vi.restoreAllMocks();
});

const API = '/api/v1';
const NOTE = 'Reviewed with the employee and their manager.';

type AnyFn = (...args: unknown[]) => unknown;

const runOf = async (userId: string) =>
  GateRun.findOne({ userId: new Types.ObjectId(userId) })
    .sort({ openedAt: -1, _id: -1 })
    .lean();

const openAttemptsUsed = async (userId: string): Promise<number> =>
  (await GateRun.findOne({ userId: new Types.ObjectId(userId), status: 'open' }).lean())
    ?.attemptsUsed ?? -1;

const modulesStatus = async (token: string): Promise<number> =>
  (
    await request(t.app)
      .get(`${API}/modules`)
      .set(...bearer(token))
  ).status;

const acknowledge = (admin: GateEmployee, escalationId: string) =>
  request(t.app)
    .patch(`${API}/admin/escalations/${escalationId}`)
    .set(...bearer(admin.token))
    .send({ action: 'acknowledge', expectedVersion: 0 });

const restore = (admin: GateEmployee, userId: string) =>
  request(t.app)
    .post(`${API}/admin/users/${userId}/restore-access`)
    .set(...bearer(admin.token))
    .send({ note: NOTE });

async function restrictedAndAcknowledged(): Promise<{
  e: GateEmployee;
  admin: GateEmployee;
  escalationId: string;
}> {
  const e = await gateEmployee(t.app, creds);
  await failGate(t.app, e);
  const esc = await escalationFor(e.id);
  const escalationId = esc?._id.toHexString() ?? '';
  const admin = await gateAdmin(t.app, creds);
  expect((await acknowledge(admin, escalationId)).status).toBe(200);
  return { e, admin, escalationId };
}

/** An error body without its per-request fields, for "no oracle" comparisons. */
const errorShape = (body: { error?: Record<string, unknown> }): Record<string, unknown> => {
  const { requestId: _r, ...rest } = body.error ?? {};
  return rest;
};

describe('P5 security: restricted access cannot be bypassed through request shape (S10)', () => {
  it('P5S-1: HEAD, trailing slash, case, encodings and method override never reach a blocked route', async () => {
    const e = await gateEmployee(t.app, creds);
    await failGate(t.app, e);
    const dummy = new Types.ObjectId().toHexString();
    const routes = allRoutes({ config: t.config, clock: t.clock, isReady: () => true }).filter(
      (r) =>
        !r.allowWhileRestricted &&
        (r.access.kind === 'authenticated' ||
          (r.access.kind === 'role' && r.access.roles.includes('employee'))),
    );
    expect(routes.length).toBeGreaterThan(15);

    const leaks: string[] = [];
    for (const r of routes) {
      const path = r.path.replace(/:[A-Za-z]+/g, dummy);
      const upper = path.replace(/[a-z]/, (c) => c.toUpperCase());
      const encoded = path.replace(
        /\/([a-z])/,
        (_m, c: string) => `/%${c.charCodeAt(0).toString(16)}`,
      );
      const variants: [string, string][] = [
        [r.method, `${API}${path}/`],
        [r.method, `${API}${upper}`],
        [r.method, `${API}${encoded}`],
        [r.method, `${API}/${path}`],
        [r.method, `${API}${path}?x=1`],
      ];
      if (r.method === 'get') variants.push(['head', `${API}${path}`], ['head', `${API}${path}/`]);
      for (const [method, url] of variants) {
        const req = request(t.app)
          [method as 'get'](url)
          .set(...bearer(e.token))
          .set('X-HTTP-Method-Override', 'GET');
        const res = method === 'get' || method === 'head' ? await req : await req.send({});
        const blocked =
          res.status === 404 ||
          (res.status === 403 &&
            (method === 'head' || res.body?.error?.code === 'ACCESS_RESTRICTED'));
        if (!blocked) leaks.push(`${method.toUpperCase()} ${url} -> ${String(res.status)}`);
      }
    }
    expect(leaks).toEqual([]);

    // Method override never turns a POST into an allowlisted GET.
    const override = await request(t.app)
      .post(`${API}/gate/status`)
      .set(...bearer(e.token))
      .set('X-HTTP-Method-Override', 'GET')
      .send({});
    expect(override.status).toBe(404);
  });

  it('P5S-1b: the allowlisted routes are reachable only with their exact method', async () => {
    const e = await gateEmployee(t.app, creds);
    await failGate(t.app, e);
    for (const [method, path] of [
      ['post', '/gate/status'],
      ['get', '/gate/challenge'],
      ['put', '/gate/challenge'],
      ['delete', '/gate/status'],
      ['patch', '/auth/me'],
    ] as const) {
      const res = await request(t.app)
        [method](`${API}${path}`)
        .set(...bearer(e.token))
        .send({});
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });
});

describe('P5 security: gate challenge integrity (S11-S13, S15)', () => {
  it('P5-M2: a wrong answer must consume an attempt even when no next question can be drawn (no 503 oracle)', async () => {
    const e = await gateEmployee(t.app, creds);
    const status = await openChallenge(t.app, e.token);
    const challengeId = status.challenge?.challengeId ?? '';
    const key = await keyFor(e.id);
    // Content is deactivated mid-challenge (Phase 7 authoring, a bad seed, an operator script):
    // fewer active questions than maxAttempts. The served challenge itself is snapshotted on the run.
    await GateQuestion.updateMany({}, { $set: { isActive: false } });

    // Try every wrong option. With the defect each one answers 503 GATE_UNAVAILABLE and consumes
    // nothing, so the employee learns "wrong" for free and walks to the key.
    const responses: number[] = [];
    for (const index of [0, 1, 2, 3].filter((i) => i !== key)) {
      const res = await postAttempt(t.app, e.token, { challengeId, selectedIndex: index });
      responses.push(res.status);
      if (res.status === 201) break;
    }
    const pass = await postAttempt(t.app, e.token, { challengeId, selectedIndex: key });
    const passed = pass.status === 201 && parseResult(pass.body).correct;
    const run = await runOf(e.id);

    // Secure outcome: the first wrong answer was recorded, and the run did not end as a clean
    // first-try pass (which would earn gate XP and lower the gate risk score).
    expect(responses).toEqual([201]);
    expect(passed && run?.firstAnswerCorrect === true).toBe(false);
  });

  it('P5S-2: stale, replayed and foreign challenge ids give one identical 409 that reveals nothing', async () => {
    const a = await gateEmployee(t.app, creds);
    const b = await gateEmployee(t.app, creds);
    const aChallenge = (await openChallenge(t.app, a.token)).challenge?.challengeId ?? '';
    const bChallenge = (await openChallenge(t.app, b.token)).challenge?.challengeId ?? '';

    // Foreign: A answers B's challenge with B's correct key.
    const foreign = await postAttempt(t.app, a.token, {
      challengeId: bChallenge,
      selectedIndex: await keyFor(b.id),
    });
    // Replay: A answers wrong, then replays the same id with the old question's key.
    const oldKey = await keyFor(a.id);
    expect((await answerWrong(t.app, a, aChallenge)).status).toBe(201);
    const replay = await postAttempt(t.app, a.token, {
      challengeId: aChallenge,
      selectedIndex: oldKey,
    });
    // Unknown id.
    const unknown = await postAttempt(t.app, a.token, {
      challengeId: new Types.ObjectId().toHexString(),
      selectedIndex: 0,
    });
    // Upper-case hex of the live id is the same id (normalised), so it is graded once, normally.
    const live = (await getStatus(t.app, a.token)).body.challenge.challengeId as string;
    const upper = await postAttempt(t.app, a.token, {
      challengeId: live.toUpperCase(),
      selectedIndex: ((await keyFor(a.id)) + 1) % 4,
    });
    expect(upper.status).toBe(201);

    for (const res of [foreign, replay, unknown]) {
      expect(res.status).toBe(409);
      expect(JSON.stringify(res.body)).not.toMatch(/explanation|correct|prompt|options|attempts/i);
    }
    expect(errorShape(foreign.body)).toEqual(errorShape(replay.body));
    expect(errorShape(foreign.body)).toEqual(errorShape(unknown.body));
    // B was not touched by A's attempt.
    expect(await openAttemptsUsed(b.id)).toBe(0);
    expect(await GateAnswer.countDocuments({ userId: new Types.ObjectId(b.id) })).toBe(0);
  });

  it('P5S-3: a 400 for an out-of-range index is the same whatever the key is (no oracle)', async () => {
    const e = await gateEmployee(t.app, creds);
    const challengeId = (await openChallenge(t.app, e.token)).challenge?.challengeId ?? '';
    const bodies = new Set<string>();
    for (const selectedIndex of [4, 5]) {
      const res = await postAttempt(t.app, e.token, { challengeId, selectedIndex });
      expect(res.status).toBe(400);
      bodies.add(JSON.stringify(errorShape(res.body)));
    }
    expect(bodies.size).toBe(1);
    expect(await openAttemptsUsed(e.id)).toBe(0);
  });

  it('P5S-4: concurrent right and wrong answers from two devices settle exactly one outcome', async () => {
    const e = await gateEmployee(t.app, creds);
    const device2 = (await loginOk(t.app, e)).accessToken;
    const challengeId = (await openChallenge(t.app, e.token)).challenge?.challengeId ?? '';
    const key = await keyFor(e.id);
    const results = await Promise.all([
      postAttempt(t.app, e.token, { challengeId, selectedIndex: key }),
      postAttempt(t.app, device2, { challengeId, selectedIndex: (key + 1) % 4 }),
      postAttempt(t.app, device2, { challengeId, selectedIndex: (key + 2) % 4 }),
      postAttempt(t.app, e.token, { challengeId, selectedIndex: key }),
    ]);
    const won = results.filter((r) => r.status === 201);
    expect(won).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await GateAnswer.countDocuments({ userId: new Types.ObjectId(e.id) })).toBe(1);
    const run = await runOf(e.id);
    expect(run?.attemptsUsed).toBe(1);
    expect(run?.firstAnswerCorrect).toBe(parseResult(won[0]?.body).correct);
  });
});

describe('P5 security: restore access (S21, S22)', () => {
  it('P5-I3 (by design, D5-7): one administrator can both acknowledge and restore', async () => {
    const { e, admin } = await restrictedAndAcknowledged();
    const res = await restore(admin, e.id);
    expect(res.status).toBe(200);
    const entry = await AuditLog.findOne({ action: 'gate.access_restored' }).lean();
    expect(String(entry?.actorId)).toBe(admin.id);
    // The note text never reaches the audit metadata.
    expect(JSON.stringify(entry?.metadata)).not.toContain(NOTE);
  });

  it('P5S-5: restoring then failing again needs a new acknowledgement (no carried-over ack)', async () => {
    const { e, admin } = await restrictedAndAcknowledged();
    expect((await restore(admin, e.id)).status).toBe(200);
    const fresh = (await loginOk(t.app, e)).accessToken;
    await failGate(t.app, { ...e, token: fresh });
    const second = await restore(admin, e.id);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ESCALATION_NOT_ACKNOWLEDGED');
    expect(await modulesStatus(fresh)).toBe(403);
  });

  it('P5-L3: a restore whose flag clear fails leaves the employee locked out with nothing to repair it', async () => {
    const { e, admin } = await restrictedAndAcknowledged();
    const real = Employee.updateOne.bind(Employee) as unknown as AnyFn;
    vi.spyOn(Employee, 'updateOne').mockImplementation(((
      filter: Record<string, unknown>,
      ...rest: unknown[]
    ) => {
      if ('gateRestriction.runId' in filter) {
        return Promise.reject(new Error('primary stepped down'));
      }
      return real(filter, ...rest);
    }) as unknown as typeof Employee.updateOne);
    const res = await restore(admin, e.id);
    vi.restoreAllMocks();
    expect(res.status).toBe(500);
    // The run is restored and audited, but the access-gate cache still blocks the employee, and
    // a second restore is refused (409 NOT_RESTRICTED).
    expect((await restore(admin, e.id)).status).toBe(409);

    // Available outcome: a background repair (marker or sweeper scan) brings the employee back.
    t.advance(5 * 60_000);
    await t.g.sweeper.sweepOnce();
    const fresh = (await loginOk(t.app, e)).accessToken;
    expect(await modulesStatus(fresh)).toBe(200);
  });

  it('P5-L4: audit failure plus rollback failure, then any reconcile, restores access with no gate.access_restored entry', async () => {
    const { e, admin } = await restrictedAndAcknowledged();
    const realAudit = audit.record.bind(audit);
    vi.spyOn(audit, 'record').mockImplementation((input) =>
      input.action === 'gate.access_restored'
        ? Promise.reject(new Error('audit store down'))
        : realAudit(input),
    );
    const realRunUpdate = GateRun.updateOne.bind(GateRun) as unknown as AnyFn;
    vi.spyOn(GateRun, 'updateOne').mockImplementation(((
      filter: Record<string, unknown>,
      ...rest: unknown[]
    ) => {
      if ('restoredBy' in filter) return Promise.reject(new Error('rollback failed'));
      return realRunUpdate(filter, ...rest);
    }) as unknown as typeof GateRun.updateOne);
    expect((await restore(admin, e.id)).status).toBe(500);
    vi.restoreAllMocks();

    // A later reconcile of this employee (a marker for any reason, an operator run) clears the
    // flag of the now "restored" run.
    await t.g.reconcile.reconcileUser(e.id);
    const fresh = (await loginOk(t.app, e)).accessToken;
    const unblocked = (await modulesStatus(fresh)) === 200;
    const audited = (await AuditLog.countDocuments({ action: 'gate.access_restored' })) > 0;
    // Invariant (restore.service doc comment): access is never restored without its record.
    expect(unblocked && !audited).toBe(false);
  });

  it("P5-L5: a restore racing reconcile's late restriction-flag write leaves a stale lockout", async () => {
    const { e, admin } = await restrictedAndAcknowledged();
    // The original flag write was lost (GT21 path); reconcile is repairing it right now.
    await Employee.updateOne({ _id: e.id }, { $set: { gateRestriction: null } });
    const real = Employee.updateOne.bind(Employee) as unknown as AnyFn;
    let raced = false;
    vi.spyOn(Employee, 'updateOne').mockImplementation(((
      filter: Record<string, unknown>,
      update: { $set?: { gateRestriction?: unknown } },
      ...rest: unknown[]
    ) => {
      if (update.$set?.gateRestriction != null && !raced) {
        raced = true;
        // The restore completes between setRestrictionFlag's "run unrestored?" check and its write.
        return restore(admin, e.id).then(() => real(filter, update, ...rest));
      }
      return real(filter, update, ...rest);
    }) as unknown as typeof Employee.updateOne);
    await t.g.reconcile.reconcileUser(e.id).catch(() => undefined);
    vi.restoreAllMocks();
    expect(raced).toBe(true);
    expect((await runOf(e.id))?.restoredAt).not.toBeNull();

    const fresh = (await loginOk(t.app, e)).accessToken;
    expect((await getStatus(t.app, fresh)).body.state).not.toBe('restricted');
    // Available outcome: the restored employee is not blocked by a stale cache entry.
    expect(await modulesStatus(fresh)).toBe(200);
  });

  it('P5-L6: a restriction whose flag write and marker were both lost is never repaired by the sweeper', async () => {
    const e = await gateEmployee(t.app, creds);
    // The flag write fails twice and the marker write fails too (database flapping).
    vi.spyOn(Employee, 'updateOne')
      .mockRejectedValueOnce(new Error('write failed'))
      .mockRejectedValueOnce(new Error('write failed again'));
    vi.spyOn(t.g.markers, 'mark').mockResolvedValue(undefined);
    await failGate(t.app, e);
    vi.restoreAllMocks();
    expect(await gateFlag(e.id)).toBeNull();
    expect(await escalationFor(e.id)).not.toBeNull();
    expect(await ReconcileMarker.countDocuments({})).toBe(0);
    // In this window the restricted employee keeps the whole learning API.
    expect(await modulesStatus(e.token)).toBe(200);

    t.advance(5 * 60_000);
    await t.g.sweeper.sweepOnce();
    const fresh = (await loginOk(t.app, e)).accessToken;
    expect(await modulesStatus(fresh)).toBe(403);
  });
});

describe('P5 security: gate XP cannot be farmed (6.9)', () => {
  it('P5S-6: one gate XP per organisation day; replays, extra runs and wrong first answers earn nothing', async () => {
    t = await buildGateApp({
      gate: { clearanceTtlSeconds: 300, orgTimeZone: 'Africa/Casablanca' },
    });
    const e = await gateEmployee(t.app, creds);
    const first = await passGate(t.app, e);
    expect(first.xpEarned).toBe(10);
    const replay = await postAttempt(t.app, e.token, {
      challengeId: new Types.ObjectId().toHexString(),
      selectedIndex: 0,
    });
    expect(replay.status).toBe(409);

    // The clearance expires after 5 minutes: a second first-try pass the same local day earns 0.
    t.advance(6 * 60_000);
    let token = (await loginOk(t.app, e)).accessToken;
    expect((await passGate(t.app, { ...e, token })).xpEarned).toBe(0);

    // A run whose first answer was wrong earns nothing, even on a new day.
    t.advance(24 * HOUR_MS);
    token = (await loginOk(t.app, e)).accessToken;
    const status = await openChallenge(t.app, token);
    const wrong = await answerWrong(t.app, { ...e, token }, status.challenge?.challengeId ?? '');
    const next = parseResult(wrong.body).status.challenge?.challengeId ?? '';
    const right = await answerRight(t.app, { ...e, token }, next);
    expect(parseResult(right.body).xpEarned).toBe(0);
    const user = await Employee.findById(e.id).select('totalXP').lean<{ totalXP: number }>();
    expect(user?.totalXP).toBe(10);
  });
});

describe('P5 security: the e2e harness is not reachable through the product app (ADR 0018)', () => {
  it('P5S-7: createApp does not answer /__harness/requests', async () => {
    const app = await createApp({ logger: silentLogger, config: testConfig() });
    for (const path of [
      '/__harness/requests',
      '/api/v1/__harness/requests',
      '/__harness/requests/',
    ]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(404);
      expect(JSON.stringify(res.body)).not.toMatch(/count/);
    }
  });
});
