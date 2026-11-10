import { Types } from 'mongoose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditIntegrityError, createAuditService } from '../src/features/audit/audit.service.js';
import { Mutex, MutexTimeoutError } from '../src/lib/mutex.js';
import { createMarkerService } from '../src/features/maintenance/markers.js';
import { createSweeper } from '../src/features/maintenance/sweeper.js';
import type { EscalationService } from '../src/features/governance/escalation.service.js';
import {
  AuditLog,
  AttemptCounter,
  Employee,
  Escalation,
  ReconcileMarker,
  UserProgress,
} from '../src/models/index.js';
import { verifyAuditChain as verifyCli } from '../src/scripts/verifyAudit.js';
import { createEmployee, makeCredentials } from './helpers/fixtures.js';
import { createCurriculum, syncLearningIndexes } from './helpers/learningFixtures.js';
import {
  adminClient,
  buildGamificationApp,
  craftHighRiskEmployee,
  createFullCurriculum,
  insertAttempts,
} from './helpers/riskFixtures.js';
import { controllableClock, silentLogger, testChainSecret } from './helpers/testConfig.js';

let creds: { password: string; hash: string };

beforeAll(async () => {
  creds = await makeCredentials();
  await syncLearningIndexes();
});

const DAY = 86_400_000;
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
const first = <T>(items: T[]): T => {
  const item = items[0];
  if (item === undefined) throw new Error('fixture');
  return item;
};

describe('P4-M3: cooldown ledger', () => {
  it('RV1: a cooldown is recorded on the ledger in the same update that starts it, with the rule in force', async () => {
    const t = await buildGamificationApp({
      learning: { cooldownAfterFails: 2, cooldownMinutes: 10 },
    });
    const cur = await createCurriculum({ count: 1 });
    const m1 = first(cur.modules);
    const { signedInEmployee, completeContent, startQuiz, submitQuiz } =
      await import('./helpers/learningFixtures.js');
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    for (let i = 0; i < 2; i += 1) {
      const { session } = await startQuiz(emp, m1.id);
      await submitQuiz(emp, m1.id, session, cur.keys, 0);
    }
    const counter = await AttemptCounter.findOne({ userId: emp.id }).lean();
    expect(counter?.cooldowns).toHaveLength(1);
    expect(counter?.cooldowns[0]).toMatchObject({ attemptNumber: 2, afterFails: 2, minutes: 10 });
    expect(counter?.cooldowns[0]?.until.getTime()).toBe(counter?.cooldownUntil?.getTime());
  });
});

describe('P4-L9: planted idempotency keys', () => {
  it('RV2: a planted unchained row holding a key makes the write fail loudly, and verify flags it whatever its date', async () => {
    const svc = createAuditService({ chainSecret: testChainSecret });
    await svc.record({ action: 'auth.logout', outcome: 'success' });
    await AuditLog.collection.insertOne({
      action: 'auth.logout',
      outcome: 'success',
      idempotencyKey: 'cooldown:planted',
      createdAt: new Date(0),
    });
    await expect(
      svc.record({ action: 'auth.logout', outcome: 'success', idempotencyKey: 'cooldown:planted' }),
    ).rejects.toBeInstanceOf(AuditIntegrityError);
    const report = await verifyCli({ secret: testChainSecret });
    expect(report).toMatchObject({
      ok: false,
      unchainedWithKey: 1,
      unchainedLegacy: 1,
      firstBreak: { seq: null, reason: 'unchained_idempotency_key' },
    });
  });
});

describe('P4-L10: abandoned writes', () => {
  it('RV3: a write that lands just before its time limit is reported as written, not as failed', async () => {
    const original = AuditLog.create.bind(AuditLog);
    const slowAfterInsert = async (...args: Parameters<typeof AuditLog.create>) => {
      const result = await original(...args);
      await sleep(200);
      return result;
    };
    const spy = vi.spyOn(AuditLog, 'create').mockImplementationOnce(slowAfterInsert);
    const svc = createAuditService({
      chainSecret: testChainSecret,
      mutex: new Mutex(),
      writeTimeoutMs: 60,
    });
    let result;
    try {
      result = await svc.record({
        action: 'user.created',
        outcome: 'success',
        metadata: { probe: 'landed' },
      });
    } finally {
      spy.mockRestore();
    }
    expect(result).toMatchObject({ duplicate: false, seq: 1 });
    expect(await AuditLog.countDocuments({ 'metadata.probe': 'landed' })).toBe(1);
  });

  it('RV4: a timeout whose outcome cannot be looked up fails closed', async () => {
    const svc = createAuditService({
      chainSecret: testChainSecret,
      mutex: new Mutex(),
      writeTimeoutMs: 30,
    });
    const realFindOne = AuditLog.findOne.bind(AuditLog);
    let calls = 0;
    const find = vi.spyOn(AuditLog, 'findOne').mockImplementation(((...args: unknown[]) => {
      calls += 1;
      // The tip read works; the lookup of the outcome after the timeout does not.
      if (calls > 1) throw new Error('database down');
      return (realFindOne as (...a: unknown[]) => unknown)(...args);
    }) as never);
    const create = vi
      .spyOn(AuditLog, 'create')
      .mockImplementationOnce((() => new Promise(() => undefined)) as never);
    try {
      await expect(
        svc.record({ action: 'auth.logout', outcome: 'success' }),
      ).rejects.toBeInstanceOf(MutexTimeoutError);
    } finally {
      find.mockRestore();
      create.mockRestore();
    }
  });

  it('RV5: the mutex aborts the signal of an abandoned task', async () => {
    const m = new Mutex();
    let aborted = false;
    await expect(
      m.run(
        (signal) =>
          new Promise<void>(() => {
            signal.addEventListener('abort', () => {
              aborted = true;
            });
          }),
        20,
      ),
    ).rejects.toBeInstanceOf(MutexTimeoutError);
    expect(aborted).toBe(true);
  });

  it('every record carries an idempotency key, generated when the caller gives none', async () => {
    const svc = createAuditService({ chainSecret: testChainSecret });
    await svc.record({ action: 'auth.logout', outcome: 'success' });
    await svc.record({ action: 'auth.logout', outcome: 'success', idempotencyKey: 'mine' });
    const rows = await AuditLog.find({}).sort({ seq: 1 }).lean();
    expect(rows[0]?.idempotencyKey).toMatch(/^auto:/);
    expect(rows[1]?.idempotencyKey).toBe('mine');
  });
});

describe('P4-L11: separation of duties for every non-remediated resolution', () => {
  const resolve = (resolution: string, v = 1) => ({
    action: 'resolve',
    expectedVersion: v,
    resolution,
    note: 'n',
  });

  it('RV6: false_positive and no_action_required need a different administrator; remediated does not', async () => {
    const t = await buildGamificationApp();
    const curriculum = await createFullCurriculum();
    for (const resolution of ['false_positive', 'no_action_required', 'risk_accepted']) {
      const e = await craftHighRiskEmployee(t.g, creds, curriculum);
      const a = await adminClient(t.app, creds);
      const b = await adminClient(t.app, creds);
      const path = `/admin/escalations/${e.escalationId}`;
      await a.patch(path, { action: 'acknowledge', expectedVersion: 0 });
      const same = await a.patch(path, resolve(resolution));
      expect(same.status, resolution).toBe(403);
      expect((same.body as { error: { code: string } }).error.code).toBe('SEPARATION_OF_DUTIES');
      expect((await b.patch(path, resolve(resolution))).status, resolution).toBe(200);
    }
    const e = await craftHighRiskEmployee(t.g, creds, curriculum);
    const a = await adminClient(t.app, creds);
    const path = `/admin/escalations/${e.escalationId}`;
    await a.patch(path, { action: 'acknowledge', expectedVersion: 0 });
    expect((await a.patch(path, resolve('remediated'))).status).toBe(200);
  });

  it('RV7: from open, any non-remediated resolution is a separation refusal; remediated stays a state error', async () => {
    const t = await buildGamificationApp();
    const e = await craftHighRiskEmployee(t.g, creds);
    const a = await adminClient(t.app, creds);
    const path = `/admin/escalations/${e.escalationId}`;
    expect((await a.patch(path, resolve('false_positive', 0))).status).toBe(403);
    expect((await a.patch(path, resolve('remediated', 0))).status).toBe(409);
  });

  it('RV8: with the flag off the acknowledger may resolve, marked sameAdmin and audited as a warning', async () => {
    const t = await buildGamificationApp({ governance: { requireSecondAdmin: false } });
    const e = await craftHighRiskEmployee(t.g, creds);
    const a = await adminClient(t.app, creds);
    const path = `/admin/escalations/${e.escalationId}`;
    await a.patch(path, { action: 'acknowledge', expectedVersion: 0 });
    const res = await a.patch(path, resolve('no_action_required'));
    expect(res.status).toBe(200);
    const entry = await AuditLog.findOne({ action: 'escalation.resolved' }).lean();
    expect(entry?.severity).toBe('warning');
    expect(entry?.metadata).toMatchObject({ sameAdmin: true });
  });
});

describe('P4-L12: stalled after becoming assessed', () => {
  async function aged(now: Date, createdDays: number) {
    const emp = await createEmployee(creds);
    await Employee.collection.updateOne(
      { _id: new Types.ObjectId(emp.id) },
      { $set: { createdAt: new Date(now.getTime() - createdDays * DAY) } },
    );
    return emp;
  }

  it('RV9: an assessed employee with an unfinished curriculum and no progress gets disengaged_no_progress; recent progress resets the clock', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 3 });
    const [m1, m2] = cur.modules;
    if (!m1 || !m2) throw new Error('fixture');
    const now = t.clock();
    const stalled = await aged(now, 60);
    const moving = await aged(now, 60);
    for (const [emp, days] of [
      [stalled, 40],
      [moving, 2],
    ] as const) {
      await insertAttempts(emp.id, [
        {
          assessmentId: m1.quizId,
          moduleId: m1.id,
          attemptNumber: 1,
          correct: 5,
          attemptedAt: new Date(now.getTime() - days * DAY),
        },
        {
          assessmentId: m2.quizId,
          moduleId: m2.id,
          attemptNumber: 1,
          correct: 5,
          attemptedAt: new Date(now.getTime() - days * DAY),
        },
      ]);
      await t.g.risk.recomputeForUser(emp.id, { type: 'reconcile' });
    }
    await t.g.sweeper.sweepOnce();
    const flags = await Escalation.find({ reason: /^disengaged/ }).lean();
    expect(flags.map((f) => [f.userId.toHexString(), f.reason])).toEqual([
      [stalled.id, 'disengaged_no_progress'],
    ]);
    // Any kind of progress counts: a module start 3 days ago clears a candidate.
    const other = await aged(now, 60);
    await UserProgress.create({
      userId: new Types.ObjectId(other.id),
      moduleId: new Types.ObjectId(m1.id),
      startedAt: new Date(now.getTime() - 3 * DAY),
    });
    expect(await t.g.escalations.evaluateDisengagement(other.id)).toBeNull();
  });

  it('RV10: finishing the curriculum clears the rule; re-flagging needs another full period after a resolution; never two active', async () => {
    const t = await buildGamificationApp();
    await createCurriculum({ count: 2 });
    const now = t.clock();
    const emp = await aged(now, 30);
    const id = await t.g.escalations.evaluateDisengagement(emp.id);
    expect(id).not.toBeNull();
    expect(await t.g.escalations.evaluateDisengagement(emp.id)).toBeNull(); // one active only
    const a = await adminClient(t.app, creds);
    const path = `/admin/escalations/${String(id)}`;
    await a.patch(path, { action: 'acknowledge', expectedVersion: 0 });
    await a.patch(path, {
      action: 'resolve',
      expectedVersion: 1,
      resolution: 'remediated',
      note: 'spoke to them',
    });
    // Resolved just now: not flagged again until another full period has passed without progress.
    expect(await t.g.escalations.evaluateDisengagement(emp.id)).toBeNull();
    t.advance(13 * DAY);
    expect(await t.g.escalations.evaluateDisengagement(emp.id)).toBeNull();
    t.advance(DAY + 1000);
    const again = await t.g.escalations.evaluateDisengagement(emp.id);
    expect(again).not.toBeNull();
    expect(again).not.toBe(id);
    expect(await Escalation.countDocuments({ userId: emp.id, reason: /^disengaged/ })).toBe(2);
    expect(
      await Escalation.countDocuments({ userId: emp.id, active: true, reason: /^disengaged/ }),
    ).toBe(1);
  });

  it('RV11: the database allows only one active disengagement flag per employee, whichever reason', async () => {
    const t = await buildGamificationApp();
    await createCurriculum({ count: 1 });
    const emp = await aged(t.clock(), 30);
    await t.g.escalations.evaluateDisengagement(emp.id);
    const dup = {
      userId: new Types.ObjectId(emp.id),
      reason: 'disengaged_no_progress',
      severity: 'elevated',
      reviewTier: 'security_team',
      scopeKey: 'disengaged',
      dedupeKey: 'other-key',
      context: {},
      sourceRef: { type: 'employee_account', id: new Types.ObjectId(emp.id) },
      openedAt: new Date(),
      events: [],
    };
    await expect(Escalation.create(dup as never)).rejects.toMatchObject({ code: 11000 });
  });
});

describe('P4-L13: markers', () => {
  it('RV12: a new reason revives a parked marker; a parked reason stays parked', async () => {
    const emp = await createEmployee(creds);
    const markers = createMarkerService({ logger: silentLogger });
    await ReconcileMarker.create({
      userId: new Types.ObjectId(emp.id),
      reasons: ['risk'],
      parkedReasons: ['risk'],
      attempts: 10,
      notBefore: new Date(Date.now() + DAY),
    });
    await markers.mark(emp.id, 'risk'); // the parked reason again: still parked
    expect((await ReconcileMarker.findOne({ userId: emp.id }).lean())?.attempts).toBe(10);
    await markers.mark(emp.id, 'xp', undefined); // a new reason
    const revived = await ReconcileMarker.findOne({ userId: emp.id }).lean();
    expect(revived).toMatchObject({ attempts: 0, notBefore: null });
    expect(revived?.reasons.sort()).toEqual(['risk', 'xp']);
    expect(revived?.parkedReasons).toEqual(['risk']);
  });

  it('RV13: a marker that exhausts its claims records its reasons as parked', async () => {
    const emp = await createEmployee(creds);
    await ReconcileMarker.create({ userId: new Types.ObjectId(emp.id), reasons: ['badge'] });
    const { clock, advance } = controllableClock();
    const sweeper = createSweeper({
      logger: silentLogger,
      clock,
      reconcile: {
        reconcileUser: () => Promise.reject(new Error('poison')),
        reconcileAll: vi.fn(),
      },
      escalations: {
        pendingAudit: () => Promise.resolve([]),
        scanDisengaged: () => Promise.resolve({ opened: 0, next: null }),
      } as unknown as EscalationService,
    });
    for (let i = 0; i < 12; i += 1) {
      advance(2 * 3_600_000);
      await sweeper.sweepOnce();
    }
    const parked = await ReconcileMarker.findOne({ userId: emp.id }).lean();
    expect(parked).toMatchObject({ attempts: 10, parkedReasons: ['badge'] });
  });

  it('RV14: a failed audit write marker keeps the exact idempotency keys', async () => {
    const emp = await createEmployee(creds);
    const markers = createMarkerService({ logger: silentLogger });
    await markers.mark(emp.id, 'audit', 'cooldown:u:a:3');
    await markers.mark(emp.id, 'audit', 'cooldown:u:a:6');
    expect((await ReconcileMarker.findOne({ userId: emp.id }).lean())?.auditKeys).toEqual([
      'cooldown:u:a:3',
      'cooldown:u:a:6',
    ]);
  });
});
