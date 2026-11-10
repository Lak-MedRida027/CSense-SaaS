import { Types } from 'mongoose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ESCALATION_ADMIN_RESERVE,
  ESCALATION_EVENTS_MAX,
  escalationActionRequestSchema,
  isCleanText,
  isWellFormedString,
} from '@csense/shared';
import {
  audit,
  createAuditService,
  sanitizeMetadata,
  toJsonValue,
} from '../src/features/audit/audit.service.js';
import { Mutex, MutexTimeoutError } from '../src/lib/mutex.js';
import { markerBackoffMs, MARKER_MAX_ATTEMPTS } from '../src/features/maintenance/sweeper.js';
import {
  AttemptCounter,
  AuditLog,
  Escalation,
  QuizAttempt,
  ReconcileMarker,
  RiskProfile,
} from '../src/models/index.js';
import { assertChainSecretDistinct } from '../src/scripts/seedLearning.js';
import { verifyAuditChain as verifyCli } from '../src/scripts/verifyAudit.js';
import { createEmployee, makeCredentials } from './helpers/fixtures.js';
import {
  completeContent,
  createCurriculum,
  signedInEmployee,
  startQuiz,
  submitQuiz,
  syncLearningIndexes,
} from './helpers/learningFixtures.js';
import { adminClient, buildGamificationApp, insertAttempts } from './helpers/riskFixtures.js';
import { randomSecret, testChainSecret } from './helpers/testConfig.js';

let creds: { password: string; hash: string };

beforeAll(async () => {
  creds = await makeCredentials();
  await syncLearningIndexes();
});

const first = <T>(items: T[]): T => {
  const item = items[0];
  if (item === undefined) throw new Error('fixture');
  return item;
};

const cooldownEntry = (userId: string, assessmentId: string) =>
  audit.record({
    action: 'learning.assessment.cooldown',
    outcome: 'success',
    severity: 'warning',
    actor: { id: userId, role: 'employee' },
    target: { type: 'user', id: userId },
    metadata: { assessmentId, kind: 'Quiz', failedAttempts: 3 },
  });

describe('P4-M1: retriggers cannot exhaust an escalation', () => {
  it('system events stop below the admin reserve; later retriggers move counters once per source', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 1 });
    const m1 = first(cur.modules);
    const emp = await createEmployee(creds);
    await cooldownEntry(emp.id, m1.quizId);
    await cooldownEntry(emp.id, m1.quizId);
    await t.g.escalations.evaluateCooldowns(emp.id);
    const budget = ESCALATION_EVENTS_MAX - ESCALATION_ADMIN_RESERVE;
    for (let i = 0; i < budget + 5; i += 1) {
      await cooldownEntry(emp.id, m1.quizId);
      await t.g.escalations.evaluateCooldowns(emp.id);
    }
    const esc = first(await Escalation.find({ userId: emp.id }).lean());
    expect(esc.events).toHaveLength(budget);
    expect(esc.retriggerCount).toBe(6);
    expect(esc.lastRetriggeredAt).toBeInstanceOf(Date);

    // Re-evaluating with nothing new counts nothing.
    await t.g.escalations.evaluateCooldowns(emp.id);
    await t.g.escalations.evaluateCooldowns(emp.id);
    expect((await Escalation.findById(esc._id).lean())?.retriggerCount).toBe(6);

    // The reviewer still has the whole reserve.
    const admin = await adminClient(t.app, creds);
    const path = `/admin/escalations/${esc._id.toHexString()}`;
    const ack = await admin.patch(path, { action: 'acknowledge', expectedVersion: esc.version });
    expect(ack.status).toBe(200);
    expect(ack.body.retriggerCount).toBe(6);
    for (let i = 0; i < ESCALATION_ADMIN_RESERVE - 2; i += 1) {
      expect((await admin.patch(path, { action: 'note', note: `n${String(i)}` })).status).toBe(200);
    }
  }, 120_000);
});

describe('P4-M2 / P4-L7: reconcile repairs cooldown escalations and audit entries', () => {
  it('rebuilds a cooldown audit entry whose write failed, from the ledger, exactly once', async () => {
    const t = await buildGamificationApp({
      learning: { cooldownAfterFails: 3, cooldownMinutes: 15 },
      accessTtlSeconds: 7200,
    });
    const cur = await createCurriculum({ count: 1 });
    const m1 = first(cur.modules);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const real = createAuditService({ chainSecret: testChainSecret });
    const spy = vi
      .spyOn(audit, 'record')
      .mockImplementation((input) =>
        input.action === 'learning.assessment.cooldown'
          ? Promise.reject(new Error('audit down'))
          : real.record(input),
      );
    try {
      for (let round = 0; round < 2; round += 1) {
        for (let i = 0; i < 3; i += 1) {
          const { session } = await startQuiz(emp, m1.id);
          await submitQuiz(emp, m1.id, session, cur.keys, 1);
        }
        t.advance(16 * 60_000);
      }
    } finally {
      spy.mockRestore();
    }
    expect(await AuditLog.countDocuments({ action: 'learning.assessment.cooldown' })).toBe(0);
    const counter = await AttemptCounter.findOne({ userId: emp.id }).lean();
    expect(counter?.cooldowns.map((c) => [c.attemptNumber, c.afterFails, c.minutes])).toEqual([
      [3, 3, 15],
      [6, 3, 15],
    ]);
    // The failed writes left a marker that carries the exact idempotency keys.
    const marker = await ReconcileMarker.findOne({ userId: emp.id }).lean();
    expect(marker?.reasons).toContain('audit');
    expect(marker?.auditKeys).toEqual([
      `cooldown:${emp.id}:${m1.quizId}:3`,
      `cooldown:${emp.id}:${m1.quizId}:6`,
    ]);

    const dry = await t.g.reconcile.reconcileUser(emp.id, { dryRun: true });
    expect(dry.auditWritten).toBe(2);
    expect(await AuditLog.countDocuments({ action: 'learning.assessment.cooldown' })).toBe(0);

    await t.g.reconcile.reconcileUser(emp.id);
    const rebuilt = await AuditLog.find({ action: 'learning.assessment.cooldown' })
      .sort({ seq: 1 })
      .lean();
    expect(rebuilt.map((r) => r.idempotencyKey)).toEqual([
      `cooldown:${emp.id}:${m1.quizId}:3`,
      `cooldown:${emp.id}:${m1.quizId}:6`,
    ]);
    expect(rebuilt[0]?.metadata).toMatchObject({
      attemptNumber: 3,
      rebuilt: true,
      failedAttempts: 3,
    });
    expect((await RiskProfile.findOne({ userId: emp.id }).lean())?.evidence?.cooldowns).toBe(2);
    expect(
      await Escalation.countDocuments({ userId: emp.id, reason: 'repeated_assessment_cooldowns' }),
    ).toBe(1);
    await t.g.reconcile.reconcileUser(emp.id);
    expect(await AuditLog.countDocuments({ action: 'learning.assessment.cooldown' })).toBe(2);
  });

  it('a cooldown written by Phase 3 carries the idempotency key and is not rebuilt', async () => {
    const t = await buildGamificationApp({
      learning: { cooldownAfterFails: 3, cooldownMinutes: 15 },
    });
    const cur = await createCurriculum({ count: 1 });
    const m1 = first(cur.modules);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    for (let i = 0; i < 3; i += 1) {
      const { session } = await startQuiz(emp, m1.id);
      await submitQuiz(emp, m1.id, session, cur.keys, 0);
    }
    const written = await AuditLog.find({ action: 'learning.assessment.cooldown' }).lean();
    expect(written).toHaveLength(1);
    expect(written[0]?.idempotencyKey).toBe(`cooldown:${emp.id}:${m1.quizId}:3`);
    await t.g.reconcile.reconcileUser(emp.id);
    expect(await AuditLog.countDocuments({ action: 'learning.assessment.cooldown' })).toBe(1);
  });
});

describe('P4-L1 / P4-L2: only chained rows count and verify reports the rest', () => {
  it('audit:verify fails on an unchained row dated after the chain, not on older legacy rows', async () => {
    await audit.record({ action: 'auth.logout', outcome: 'success' });
    await AuditLog.collection.insertOne({
      action: 'auth.logout',
      outcome: 'success',
      createdAt: new Date(0),
    });
    expect(await verifyCli({ secret: testChainSecret })).toMatchObject({
      ok: true,
      unchainedLegacy: 1,
      unchainedAfterChain: 0,
    });
    await AuditLog.collection.insertOne({
      action: 'auth.logout',
      outcome: 'success',
      createdAt: new Date(Date.now() + 1000),
    });
    const bad = await verifyCli({ secret: testChainSecret });
    expect(bad).toMatchObject({
      ok: false,
      unchainedLegacy: 1,
      unchainedAfterChain: 1,
      firstBreak: { seq: null, reason: 'unchained_after_chain' },
    });
  });

  it('a non-numeric seq is reported as a break and does not stop later writes', async () => {
    await audit.record({ action: 'auth.logout', outcome: 'success' });
    await AuditLog.collection.insertOne({
      seq: 'zzz',
      action: 'auth.logout',
      outcome: 'success',
      createdAt: new Date(),
    });
    await audit.record({ action: 'auth.logout', outcome: 'success' });
    const report = await verifyCli({ secret: testChainSecret });
    expect(report).toMatchObject({
      ok: false,
      nonNumericSeq: 1,
      checked: 2,
      firstBreak: { seq: null, reason: 'non_numeric_seq' },
    });
  });

  it('forged unchained rows are not listed by the admin audit log', async () => {
    const t = await buildGamificationApp();
    const admin = await adminClient(t.app, creds);
    await AuditLog.collection.insertOne({
      action: 'learning.assessment.cooldown',
      outcome: 'success',
      createdAt: new Date(),
      seq: 'x',
    });
    const res = await admin.get('/admin/audit-logs?limit=200');
    expect(res.status).toBe(200);
    expect((res.body.items as { seq: unknown }[]).every((i) => typeof i.seq === 'number')).toBe(
      true,
    );
  });
});

describe('P4-L3 / P4-L6: metadata canonicalisation', () => {
  it('passes ObjectIds and Dates through and refuses other non-plain objects', () => {
    const id = new Types.ObjectId();
    expect(toJsonValue(sanitizeMetadata({ id, at: new Date(0), nested: [{ id }] }))).toEqual({
      id: id.toHexString(),
      at: '1970-01-01T00:00:00.000Z',
      nested: [{ id: id.toHexString() }],
    });
    for (const bad of [new Map([['a', 1]]), Buffer.from('x'), new URL('http://x.test'), /re/]) {
      expect(() => sanitizeMetadata({ bad })).toThrow(/plain/);
      expect(() => toJsonValue({ bad })).toThrow(/plain/);
    }
    expect(
      toJsonValue(sanitizeMetadata(Object.assign(Object.create(null) as object, { ok: 1 }))),
    ).toEqual({ ok: 1 });
  });

  it('refuses lone surrogates in values and keys without consuming a seq; normalises request text', async () => {
    await audit.record({ action: 'auth.logout', outcome: 'success' });
    await expect(
      audit.record({ action: 'auth.logout', outcome: 'success', metadata: { v: 'a\ud800b' } }),
    ).rejects.toThrow(/well-formed/);
    await expect(
      audit.record({ action: 'auth.logout', outcome: 'success', metadata: { ['k\udc00']: 1 } }),
    ).rejects.toThrow(/well-formed/);
    expect(await AuditLog.countDocuments()).toBe(1);
    // Request-derived text is normalised, so it can never make the chain unverifiable.
    await audit.record({
      action: 'auth.logout',
      outcome: 'success',
      ctx: { userAgent: 'ua\ud800' },
    });
    const row = await AuditLog.findOne({ seq: 2 }).lean();
    expect(row?.userAgent).toBe('ua�');
    expect((await verifyCli({ secret: testChainSecret })).ok).toBe(true);
    // Valid astral characters are fine.
    await audit.record({
      action: 'auth.logout',
      outcome: 'success',
      metadata: { v: 'ok \u{1F600}' },
    });
    expect((await verifyCli({ secret: testChainSecret })).ok).toBe(true);
  });

  it('shared text rules: lone surrogates and control characters are rejected in notes and references', () => {
    expect(isWellFormedString('a\u{1F600}b')).toBe(true);
    expect(isWellFormedString('\ud83d')).toBe(false);
    expect(isWellFormedString('\ude00x')).toBe(false);
    expect(isCleanText('line\nbreak\ttab')).toBe(true);
    expect(isCleanText('bell\u0007')).toBe(false);
    const resolve = { action: 'resolve', expectedVersion: 1, resolution: 'remediated', note: 'ok' };
    expect(
      escalationActionRequestSchema.safeParse({ ...resolve, managementReference: 'REF-1' }).success,
    ).toBe(true);
    for (const bad of ['REF-\ud800', 'REF\u0000', 'REF\u0007x']) {
      expect(
        escalationActionRequestSchema.safeParse({ ...resolve, managementReference: bad }).success,
        bad,
      ).toBe(false);
    }
    expect(
      escalationActionRequestSchema.safeParse({ action: 'note', note: 'bad \ud800' }).success,
    ).toBe(false);
  });
});

describe('P4-L4: marker back-off', () => {
  it('doubles from 30 s up to a one-hour cap', () => {
    expect([1, 2, 3, 4].map(markerBackoffMs)).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(markerBackoffMs(MARKER_MAX_ATTEMPTS)).toBe(3_600_000);
    expect(markerBackoffMs(50)).toBe(3_600_000);
  });

  it('a marker added to during its reconcile is handed back instead of deleted', async () => {
    const t = await buildGamificationApp();
    const emp = await createEmployee(creds);
    await ReconcileMarker.create({ userId: new Types.ObjectId(emp.id), reasons: ['risk'] });
    const real = t.g.reconcile.reconcileUser.bind(t.g.reconcile);
    t.g.reconcile.reconcileUser = async (userId, opts) => {
      await t.g.markers.mark(userId, 'xp'); // a new failure lands while we work
      return real(userId, opts);
    };
    await t.g.sweeper.sweepOnce();
    const left = await ReconcileMarker.findOne({ userId: emp.id }).lean();
    expect(left?.reasons).toEqual(['risk', 'xp']);
    expect(left?.attempts).toBe(0);
    expect(left?.notBefore).toBeNull();
  });
});

describe('Info items', () => {
  it('the audit mutex abandons a hung task, fails that caller and keeps the queue moving', async () => {
    const m = new Mutex();
    const hung = m.run(() => new Promise<string>(() => undefined), 30);
    const next = m.run(() => Promise.resolve('ok'), 30);
    await expect(hung).rejects.toBeInstanceOf(MutexTimeoutError);
    await expect(next).resolves.toBe('ok');
  });

  it('a hung audit write fails closed and later writes still succeed', async () => {
    const svc = createAuditService({ chainSecret: testChainSecret, writeTimeoutMs: 40 });
    // Same shared mutex, normal timeout: a loaded machine must not time the healthy write out.
    const healthy = createAuditService({ chainSecret: testChainSecret });
    const originalFindOne = AuditLog.findOne.bind(AuditLog);
    let hang = true;
    // First tip read never resolves.
    (AuditLog as unknown as { findOne: unknown }).findOne = (...args: unknown[]) =>
      hang
        ? ({
            sort: () => ({ select: () => ({ lean: () => new Promise(() => undefined) }) }),
          } as never)
        : (originalFindOne as (...a: unknown[]) => unknown)(...args);
    try {
      await expect(
        svc.record({ action: 'auth.logout', outcome: 'success' }),
      ).rejects.toBeInstanceOf(MutexTimeoutError);
      hang = false;
      await expect(
        healthy.record({ action: 'auth.logout', outcome: 'success' }),
      ).resolves.toMatchObject({
        duplicate: false,
      });
    } finally {
      (AuditLog as unknown as { findOne: unknown }).findOne = originalFindOne;
    }
  });

  it('the attempt reads used by risk and XP are ordered by id', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 1 });
    const m1 = first(cur.modules);
    const emp = await createEmployee(creds);
    await insertAttempts(emp.id, [
      { assessmentId: m1.quizId, moduleId: m1.id, attemptNumber: 1, correct: 1 },
      { assessmentId: m1.quizId, moduleId: m1.id, attemptNumber: 2, correct: 5 },
    ]);
    const ids = (await QuizAttempt.find({ userId: emp.id }).sort({ _id: 1 }).lean()).map(
      (a) => a.attemptNumber,
    );
    expect(ids).toEqual([1, 2]);
    await t.g.risk.recomputeForUser(emp.id, { type: 'reconcile' });
    expect((await RiskProfile.findOne({ userId: emp.id }).lean())?.knowledgeScore).toBe(80);
  });

  it('seed and CLI scripts reject a chain secret equal to a JWT secret, without echoing it', () => {
    const shared = randomSecret();
    for (const key of ['JWT_ACCESS_SECRET', 'REFRESH_TOKEN_SECRET'] as const) {
      let message = '';
      try {
        assertChainSecretDistinct({ AUDIT_CHAIN_SECRET: shared, [key]: shared });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain(key);
      expect(message).not.toContain(shared);
    }
    expect(() => {
      assertChainSecretDistinct({ AUDIT_CHAIN_SECRET: shared, JWT_ACCESS_SECRET: randomSecret() });
    }).not.toThrow();
    expect(() => {
      assertChainSecretDistinct({});
    }).not.toThrow();
  });
});
