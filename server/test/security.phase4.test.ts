/**
 * Phase 4 adversarial regression suite (security-tester review of gamification, risk, governance
 * and the hash-chained audit log). Findings are named P4-<severity><n> in the review report.
 *
 * Convention: a test that exposes a real, still-open defect is `it.fails` with a comment naming its
 * finding, so the suite stays green and the test flips to a failure (and must be converted to a
 * plain `it`) once the defect is fixed. Tests that pin an accepted limitation say so explicitly.
 */
import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import { Types } from 'mongoose';
import { pino } from 'pino';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ESCALATION_EVENTS_MAX,
  RISK_BANDS,
  RISK_WEIGHTS_BP,
  classifyRisk,
  computeComposite,
} from '@csense/shared';
import { createApp } from '../src/app.js';
import {
  audit,
  configureAudit,
  createAuditService,
  type AuditService,
} from '../src/features/audit/audit.service.js';
import type { GamificationServices } from '../src/features/gamification/services.js';
import type { EscalationService } from '../src/features/governance/escalation.service.js';
import { createSweeper } from '../src/features/maintenance/sweeper.js';
import { Mutex } from '../src/lib/mutex.js';
import {
  AuditLog,
  BadgeAward,
  Employee,
  Escalation,
  Module,
  ReconcileMarker,
  RiskProfile,
} from '../src/models/index.js';
import { verifyAndRecord } from '../src/scripts/verifyAudit.js';
import { createEmployee, makeCredentials } from './helpers/fixtures.js';
import {
  completeContent,
  createCurriculum,
  passModule,
  signedInEmployee,
  startQuiz,
  submitQuiz,
  syncLearningIndexes,
} from './helpers/learningFixtures.js';
import {
  adminClient,
  buildGamificationApp,
  craftHighRiskEmployee,
  insertAttempts,
  seedBadgesFor,
  verifyAuditChain,
} from './helpers/riskFixtures.js';
import {
  controllableClock,
  silentLogger,
  testChainSecret,
  testConfig,
} from './helpers/testConfig.js';

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

/** A cooldown entry exactly as Phase 3 writes it (through the chained service). */
const cooldownEntry = (userId: string, assessmentId: string, svc: AuditService = audit) =>
  svc.record({
    action: 'learning.assessment.cooldown',
    outcome: 'success',
    severity: 'warning',
    actor: { id: userId, role: 'employee' },
    target: { type: 'user', id: userId },
    metadata: { assessmentId, kind: 'Quiz', failedAttempts: 3 },
  });

/** Every key in a JSON body, at any depth. */
function allKeys(body: unknown): string[] {
  if (Array.isArray(body)) return body.flatMap(allKeys);
  if (typeof body === 'object' && body !== null) {
    return Object.entries(body).flatMap(([k, v]) => [k, ...allKeys(v)]);
  }
  return [];
}

/** An app whose logger writes every line into `lines`, for log-leak checks. */
async function buildCapturingApp() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString('utf8'));
      cb();
    },
  });
  const logger = pino({ level: 'trace' }, stream);
  const config = testConfig();
  const { clock } = controllableClock();
  const notifier = { escalationOpened: vi.fn(), escalationRetriggered: vi.fn() };
  const app = await createApp({ logger, config, clock, notifier });
  return { app, config, lines, g: app.locals.gamification as GamificationServices };
}

const escalationIdOf = (path: string): string => path.split('/').at(-1) ?? '';

// ------------------------------------------------------------------------------------------------
describe('authorisation and IDOR (Phase 4 routes)', () => {
  it('SEC-A1: /me/xp and /me/badges refuse any user selector; each employee only sees their own totals', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 2 });
    await seedBadgesFor(cur);
    const victim = await signedInEmployee(t.app, creds);
    await passModule(victim, first(cur.modules), cur.keys);
    const attacker = await signedInEmployee(t.app, creds);

    for (const path of [
      `/me/xp?userId=${victim.id}`,
      `/me/badges?userId=${victim.id}`,
      '/me/xp?user[$ne]=x',
      `/me/badges?id=${victim.id}`,
    ]) {
      expect((await attacker.get(path)).status, path).toBe(400);
    }
    const own = await attacker.get('/me/xp');
    expect(own.status).toBe(200);
    expect(own.body.totalXP).toBe(0);
    expect((await attacker.get('/me/badges')).body.earnedCount).toBe(0);
    expect((await victim.get('/me/xp')).body.totalXP).toBe(300);
  });

  it('SEC-A2: an administrator token is refused on the employee-only /me gamification routes', async () => {
    const t = await buildGamificationApp();
    const admin = await adminClient(t.app, creds);
    expect((await admin.get('/me/xp')).status).toBe(403);
    expect((await admin.get('/me/badges')).status).toBe(403);
  });

  it('SEC-A3: operator and array injection in admin list filters is a 400, never a widened query', async () => {
    const t = await buildGamificationApp();
    await craftHighRiskEmployee(t.g, creds);
    const admin = await adminClient(t.app, creds);
    const id = new Types.ObjectId().toHexString();
    for (const path of [
      '/admin/audit-logs?action[$ne]=auth.logout',
      '/admin/audit-logs?actorId[$exists]=true',
      `/admin/audit-logs?targetId=${id}&targetId=${id}`,
      '/admin/audit-logs?before=0',
      '/admin/audit-logs?before=abc',
      '/admin/audit-logs?limit=201',
      '/admin/audit-logs?from=2026-01-01',
      '/admin/audit-logs?seq=1',
      '/admin/audit-logs?metadata.reason=x',
      '/admin/escalations?userId[$exists]=true',
      '/admin/escalations?status[$in]=open',
      '/admin/escalations?pageSize=101',
      '/admin/escalations?page=0',
      '/admin/risk-profiles?department[$ne]=x',
      '/admin/risk-profiles?department=a&department=b',
      '/admin/risk-profiles?sort=p.compositeScore',
      '/admin/risk-profiles?level=unassessed&role=administrator',
      `/admin/users/${id}x/risk-profile`,
    ]) {
      const res = await admin.get(path);
      expect(res.status, path).toBe(400);
      expect(res.body.error.code, path).toBe('VALIDATION_ERROR');
    }
  });

  it('SEC-A4: department is matched literally inside the aggregation (no regex or operator semantics)', async () => {
    const t = await buildGamificationApp();
    await craftHighRiskEmployee(t.g, creds);
    const admin = await adminClient(t.app, creds);
    const all = await admin.get('/admin/risk-profiles');
    expect(all.body.total).toBeGreaterThan(0);
    for (const dept of ['.*', '$ne', '{"$ne":null}', '^']) {
      const res = await admin.get(`/admin/risk-profiles?department=${encodeURIComponent(dept)}`);
      expect(res.status, dept).toBe(200);
      expect(res.body.total, dept).toBe(0);
    }
  });

  it('SEC-A5: nothing an employee can fetch carries a risk score, level, dimension or escalation', async () => {
    const t = await buildGamificationApp({
      learning: { cooldownAfterFails: 3, cooldownMinutes: 15 },
    });
    const cur = await createCurriculum({ count: 2 });
    const m1 = first(cur.modules);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const bodies: unknown[] = [];
    for (let i = 0; i < 3; i += 1) {
      const { session } = await startQuiz(emp, m1.id);
      const res = await submitQuiz(emp, m1.id, session, cur.keys, 0);
      expect(res.status).toBe(201);
      bodies.push(res.body);
    }
    expect(await RiskProfile.countDocuments({ userId: emp.id })).toBe(1);
    for (const path of ['/me/xp', '/me/badges', '/me/attempts', '/auth/me', '/modules']) {
      const res = await emp.get(path);
      expect(res.status, path).toBe(200);
      bodies.push(res.body);
    }
    const blocked = await startQuiz(emp, m1.id);
    bodies.push(blocked.res.body);
    const leaked = allKeys(bodies).filter((k) =>
      /risk|composite|behaviou?ral|knowledge|engagement|simulation|escalat|coverage/i.test(k),
    );
    expect(leaked).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------
describe('escalation workflow under attack', () => {
  const setup = async () => {
    const t = await buildGamificationApp();
    const e = await craftHighRiskEmployee(t.g, creds);
    const admin = await adminClient(t.app, creds);
    return { t, e, admin, path: `/admin/escalations/${e.escalationId}` };
  };

  it('SEC-E1: racing acknowledges and then racing resolves from two administrators: one winner each, no lost or duplicated event', async () => {
    const { t, admin, path } = await setup();
    const admin2 = await adminClient(t.app, creds);
    const acks = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        (i % 2 ? admin : admin2).patch(path, { action: 'acknowledge', expectedVersion: 0 }),
      ),
    );
    expect(acks.filter((r) => r.status === 200)).toHaveLength(1);
    expect(acks.filter((r) => r.status === 409)).toHaveLength(5);

    const resolves = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        (i % 2 ? admin : admin2).patch(path, {
          action: 'resolve',
          expectedVersion: 1,
          resolution: i % 2 ? 'remediated' : 'false_positive',
          note: `resolution ${String(i)}`,
        }),
      ),
    );
    expect(resolves.filter((r) => r.status === 200)).toHaveLength(1);
    const esc = await Escalation.findById(escalationIdOf(path)).lean();
    expect(esc?.events.map((ev) => ev.type)).toEqual(['opened', 'acknowledged', 'resolved']);
    expect(esc?.version).toBe(2);
    for (const ev of esc?.events ?? []) {
      const key = `escalation:${String(esc?._id)}:event:${ev.eventId.toHexString()}`;
      expect(await AuditLog.countDocuments({ idempotencyKey: key })).toBe(1);
    }
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it('SEC-E2: a note racing a resolve never loses either event and never reopens the escalation', async () => {
    const { admin, path } = await setup();
    expect((await admin.patch(path, { action: 'acknowledge', expectedVersion: 0 })).status).toBe(
      200,
    );
    const [note, resolve] = await Promise.all([
      admin.patch(path, { action: 'note', note: 'racing note' }),
      admin.patch(path, {
        action: 'resolve',
        expectedVersion: 1,
        resolution: 'remediated',
        note: 'done',
      }),
    ]);
    // Whichever lands first wins; a resolve that lost to the note sees a stale version (409) and
    // the escalation stays acknowledged. Nothing is ever lost or applied twice.
    for (const r of [note, resolve]) expect([200, 409]).toContain(r.status);
    expect(note.status).toBe(200);
    const esc = await Escalation.findById(escalationIdOf(path)).lean();
    const resolved = resolve.status === 200;
    expect(esc?.status).toBe(resolved ? 'resolved' : 'acknowledged');
    expect(esc?.active).toBe(!resolved);
    const added = [note, resolve].filter((r) => r.status === 200).length;
    expect(esc?.events).toHaveLength(2 + added);
    expect(esc?.version).toBe(1 + added);
    for (const ev of esc?.events ?? []) {
      const key = `escalation:${String(esc?._id)}:event:${ev.eventId.toHexString()}`;
      expect(await AuditLog.countDocuments({ idempotencyKey: key })).toBe(1);
    }
  });

  it('SEC-E3: a resolved escalation cannot be acknowledged or resolved again, and server-owned fields cannot be mass-assigned', async () => {
    const { admin, path } = await setup();
    await admin.patch(path, { action: 'acknowledge', expectedVersion: 0 });
    await admin.patch(path, {
      action: 'resolve',
      expectedVersion: 1,
      resolution: 'remediated',
      note: 'fixed',
    });
    for (const body of [
      { action: 'acknowledge', expectedVersion: 2 },
      { action: 'resolve', expectedVersion: 2, resolution: 'risk_accepted', note: 'overwrite' },
    ]) {
      const res = await admin.patch(path, body);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    }
    expect((await Escalation.findById(escalationIdOf(path)).lean())?.resolution).toBe('remediated');
    for (const extra of [
      { status: 'open' },
      { active: true },
      { version: 0 },
      { resolvedBy: new Types.ObjectId().toHexString() },
      { events: [] },
      { actorId: new Types.ObjectId().toHexString() },
    ]) {
      const res = await admin.patch(path, { action: 'note', note: 'x', ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
  });

  it('SEC-E4: note text never reaches audit metadata or any log line, even when the audit write fails', async () => {
    const { app, lines, g } = await buildCapturingApp();
    const e = await craftHighRiskEmployee(g, creds);
    const admin = await adminClient(app, creds);
    const path = `/admin/escalations/${e.escalationId}`;
    const marker = `PII-NOTE-${new Types.ObjectId().toHexString()}`;

    const real = createAuditService({ chainSecret: testChainSecret });
    const spy = vi.spyOn(audit, 'record').mockImplementation((input) => {
      if (input.action === 'escalation.note_added') {
        return Promise.reject(new Error('audit down'));
      }
      return real.record(input);
    });
    try {
      const res = await admin.patch(path, { action: 'note', note: `${marker} first` });
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain(marker);
    } finally {
      spy.mockRestore();
    }
    await g.escalations.flushAudit(e.escalationId);
    expect((await admin.patch(path, { action: 'note', note: `${marker} second` })).status).toBe(
      200,
    );
    expect(await AuditLog.countDocuments({ action: 'escalation.note_added' })).toBe(2);
    expect(JSON.stringify(await AuditLog.find({}).lean())).not.toContain(marker);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.filter((l) => l.includes(marker))).toEqual([]);
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  // Regression for the P4-L6 vector: managementReference is free text with no character check and
  // it is copied into audit metadata. Today the chain survives only because flushAudit re-reads
  // the escalation from MongoDB (which has already replaced the lone surrogate with U+FFFD) before
  // hashing. If the outbox ever hashes the in-memory request value, this test catches it.
  it('SEC-E5: a lone surrogate in managementReference does not break the audit chain', async () => {
    const t = await buildGamificationApp();
    const emp = await createEmployee(creds);
    const { escalationId } = await t.g.escalations.recordCriticalEvent({
      userId: emp.id,
      reason: 'gate_access_restricted',
      sourceRef: { type: 'gate_event', id: new Types.ObjectId().toHexString() },
      occurredAt: new Date(),
    });
    const admin = await adminClient(t.app, creds);
    const path = `/admin/escalations/${escalationId}`;
    expect((await admin.patch(path, { action: 'acknowledge', expectedVersion: 0 })).status).toBe(
      200,
    );
    const res = await admin.patch(path, {
      action: 'resolve',
      expectedVersion: 1,
      resolution: 'remediated',
      note: 'ok',
      managementReference: 'MGMT-\ud800',
    });
    // Either the input is refused (preferred) or the chain must still verify.
    if (res.status === 400) return;
    expect(res.status).toBe(200);
    const report = await verifyAuditChain();
    expect(report.firstBreak).toBeNull();
    expect(report.ok).toBe(true);
  });

  // P4-M1: retriggered events are pushed with no cap (only admin transitions check the 200-event
  // limit). An employee who keeps earning cooldowns on one quiz grows the escalation past 200
  // events, after which every acknowledge/note/resolve is a 409: the record can never be closed.
  it('SEC-E6 (P4-M1): retriggers cannot push an escalation past the event cap and lock out the reviewer', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 1 });
    const m1 = first(cur.modules);
    const emp = await createEmployee(creds);
    await cooldownEntry(emp.id, m1.quizId);
    await cooldownEntry(emp.id, m1.quizId);
    await t.g.escalations.evaluateCooldowns(emp.id);
    const esc = first(await Escalation.find({ userId: emp.id }).lean());
    const admin = await adminClient(t.app, creds);
    const path = `/admin/escalations/${esc._id.toHexString()}`;
    expect((await admin.patch(path, { action: 'acknowledge', expectedVersion: 0 })).status).toBe(
      200,
    );

    for (let i = 0; i < ESCALATION_EVENTS_MAX; i += 1) {
      await cooldownEntry(emp.id, m1.quizId);
      await t.g.escalations.evaluateCooldowns(emp.id);
    }
    const grown = await Escalation.findById(esc._id).lean();
    // Observed today: 202 events, and the resolve below is a 409 "maximum number of events".
    const res = await admin.patch(path, {
      action: 'resolve',
      expectedVersion: grown?.version ?? 0,
      resolution: 'remediated',
      note: 'coached',
    });
    expect(res.body).toMatchObject({ status: 'resolved' });
    expect(res.status).toBe(200);
    expect(grown?.events.length ?? 0).toBeLessThanOrEqual(ESCALATION_EVENTS_MAX);
  }, 180_000);

  // P4-M2: evaluateCooldowns runs after the profile write inside recomputeForUser. If it fails
  // (transient DB error), the hook leaves a 'risk' marker, but the sweeper's reconcile only calls
  // recomputeForUser when the profile has drifted, and it does not: the profile was saved. The
  // cooldown escalation is therefore never opened by the repair path, contrary to ADR 0011
  // ("the check runs on every attempt and in reconcile").
  it('SEC-E8 (P4-M2): a cooldown escalation missed by a failed hook is opened by the sweeper', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 2 });
    const m1 = first(cur.modules);
    const emp = await createEmployee(creds);
    await insertAttempts(emp.id, [
      { assessmentId: m1.quizId, moduleId: m1.id, attemptNumber: 1, correct: 1 },
    ]);
    await cooldownEntry(emp.id, m1.quizId);
    await cooldownEntry(emp.id, m1.quizId);
    const spy = vi
      .spyOn(t.g.escalations, 'evaluateCooldowns')
      .mockRejectedValueOnce(new Error('transient database error'));
    try {
      await t.g.hooks.onAttemptRecorded({
        userId: emp.id,
        attemptId: new Types.ObjectId().toHexString(),
        kind: 'Quiz',
        assessmentId: m1.quizId,
        moduleId: m1.id,
        attemptNumber: 1,
        endReason: 'submitted',
        score: 20,
        passed: false,
        correctCount: 1,
        totalCount: 5,
        at: new Date(),
      });
    } finally {
      spy.mockRestore();
    }
    expect(await ReconcileMarker.countDocuments({ userId: emp.id })).toBe(1);
    expect(await Escalation.countDocuments({ userId: emp.id })).toBe(0);
    await t.g.sweeper.sweepOnce();
    expect(await ReconcileMarker.countDocuments({ userId: emp.id })).toBe(0);
    expect(
      await Escalation.countDocuments({
        userId: emp.id,
        reason: 'repeated_assessment_cooldowns',
      }),
    ).toBe(1);
  });

  // P4-L7: the cooldown audit entry is the ONLY record Phase 4 reads for the Behavioural cooldown
  // penalty and the cooldown escalation, yet Phase 3 swallows a failure to write it (log only, no
  // marker, no idempotency key), so the cooldown is lost to risk and governance for good, while the
  // cooldown itself is enforced.
  it('SEC-E9 (P4-L7): a cooldown whose audit write failed is still counted after reconcile', async () => {
    const t = await buildGamificationApp({
      learning: { cooldownAfterFails: 3, cooldownMinutes: 15 },
    });
    const cur = await createCurriculum({ count: 2 });
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
      for (let i = 0; i < 3; i += 1) {
        const { res, session } = await startQuiz(emp, m1.id);
        expect(res.status).toBe(201);
        expect((await submitQuiz(emp, m1.id, session, cur.keys, 0)).status).toBe(201);
      }
      // The cooldown is enforced...
      expect((await startQuiz(emp, m1.id)).res.status).toBe(409);
    } finally {
      spy.mockRestore();
    }
    await t.g.reconcile.reconcileUser(emp.id);
    await t.g.sweeper.sweepOnce();
    // ...but it never reaches the risk profile.
    const profile = await RiskProfile.findOne({ userId: emp.id }).lean();
    expect(profile?.evidence?.cooldowns).toBe(1);
  });

  it('SEC-E7: a cooldown escalation is opened once for a burst of concurrent recomputes', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 1 });
    const m1 = first(cur.modules);
    const emp = await createEmployee(creds);
    await cooldownEntry(emp.id, m1.quizId);
    await cooldownEntry(emp.id, m1.quizId);
    await Promise.all(
      Array.from({ length: 8 }, () => t.g.risk.recomputeForUser(emp.id, { type: 'reconcile' })),
    );
    const escs = await Escalation.find({ userId: emp.id }).lean();
    expect(escs).toHaveLength(1);
    expect(first(escs).events.map((ev) => ev.type)).toEqual(['opened']);
    expect(t.notifier.escalationOpened).toHaveBeenCalledTimes(1);
    expect(await AuditLog.countDocuments({ action: 'escalation.opened' })).toBe(1);
  });
});

// ------------------------------------------------------------------------------------------------
describe('audit chain integrity', () => {
  it('SEC-C1: three independent writers (separate mutexes, like separate processes) plus idempotent retries keep the chain dense', async () => {
    const writers: AuditService[] = [
      createAuditService({ chainSecret: testChainSecret, mutex: new Mutex() }),
      createAuditService({ chainSecret: testChainSecret, mutex: new Mutex() }),
      audit,
    ];
    const jobs: Promise<unknown>[] = [];
    for (let i = 0; i < 45; i += 1) {
      const w = writers[i % writers.length] ?? audit;
      jobs.push(
        w.record({
          action: 'auth.logout',
          outcome: 'success',
          metadata: { i, nested: { z: 1, a: [true, null, 'é'] } },
          ...(i % 5 === 0 ? { idempotencyKey: `dup-${String(i % 3)}` } : {}),
        }),
      );
    }
    await Promise.all(jobs);
    const report = await verifyAuditChain();
    expect(report.ok).toBe(true);
    const count = await AuditLog.countDocuments();
    expect(report.checked).toBe(count);
    expect(report.tipSeq).toBe(count);
  });

  it('SEC-C2: renumbering a seq and recomputing a hash without the key are both caught', async () => {
    for (let i = 0; i < 4; i += 1) {
      await audit.record({ action: 'auth.logout', outcome: 'success', metadata: { i } });
    }
    const raw = AuditLog.collection;
    await raw.updateOne({ seq: 4 }, { $set: { seq: 5 } });
    expect((await verifyAuditChain()).firstBreak).toEqual({ seq: 4, reason: 'gap' });
    await raw.updateOne({ seq: 5 }, { $set: { seq: 4 } });
    expect((await verifyAuditChain()).ok).toBe(true);

    await raw.updateOne(
      { seq: 2 },
      { $set: { severity: 'critical', hash: createHash('sha256').update('x').digest('hex') } },
    );
    const broken = await verifyAuditChain();
    expect(broken.ok).toBe(false);
    expect(broken.firstBreak?.seq).toBe(2);
  });

  it('SEC-C3 (accepted limitation, ADR 0012): fields outside the hash and a truncated tail pass verify alone; extra fields never reach the API', async () => {
    const t = await buildGamificationApp();
    const admin = await adminClient(t.app, creds);
    for (let i = 0; i < 3; i += 1) {
      await audit.record({ action: 'auth.logout', outcome: 'success', metadata: { i } });
    }
    const raw = AuditLog.collection;
    await raw.updateOne({ seq: 2 }, { $set: { injected: '<script>x</script>', note: 'forged' } });
    expect((await verifyAuditChain()).ok).toBe(true);
    const list = await admin.get('/admin/audit-logs');
    expect(JSON.stringify(list.body)).not.toContain('forged');
    expect(JSON.stringify(list.body)).not.toContain('<script>');

    const before = await verifyAndRecord({ secret: testChainSecret });
    expect(before.ok).toBe(true);
    const tip = before.tipSeq ?? 0;
    await raw.deleteMany({ seq: { $gte: tip } });
    const after = await verifyAuditChain();
    expect(after.ok).toBe(true);
    expect(after.tipSeq).toBeLessThan(tip);
  });

  it('SEC-C4: the audit facade fails closed when no service is configured, and a login then issues no tokens', async () => {
    const t = await buildGamificationApp();
    const emp = await createEmployee(creds);
    configureAudit(null as unknown as AuditService);
    try {
      await expect(audit.record({ action: 'auth.logout', outcome: 'success' })).rejects.toThrow(
        'Audit service is not configured',
      );
      const res = await request(t.app)
        .post('/api/v1/auth/login')
        .send({ email: emp.email, password: emp.password });
      expect(res.status).toBe(500);
      expect(res.body.accessToken).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain(testChainSecret);
    } finally {
      configureAudit(createAuditService({ chainSecret: testChainSecret }));
    }
  });

  it('SEC-C5: no Phase 4 response, verify report or stored entry contains a server secret', async () => {
    const t = await buildGamificationApp();
    const e = await craftHighRiskEmployee(t.g, creds);
    const admin = await adminClient(t.app, creds);
    const report = await verifyAndRecord({ secret: testChainSecret });
    const bodies = await Promise.all([
      admin.get('/admin/audit-logs?limit=200'),
      admin.get(`/admin/escalations/${e.escalationId}`),
      admin.get('/admin/escalations'),
      admin.get('/admin/risk-profiles'),
      admin.get(`/admin/users/${e.id}/risk-profile`),
    ]);
    const secrets = [testChainSecret, t.config.jwtAccessSecret, t.config.refreshTokenSecret];
    const haystack = [
      JSON.stringify(report),
      JSON.stringify(await AuditLog.find({}).lean()),
      ...bodies.map((b) => JSON.stringify(b.body)),
    ].join('\n');
    for (const s of secrets) expect(haystack).not.toContain(s);
    const wrong = await verifyAuditChain('wrong-key-for-a-test-only-not-a-secret-0000');
    expect(wrong.firstBreak?.reason).toBe('hash_mismatch');
  });

  // P4-L1: the risk engine and the cooldown escalation read `learning.assessment.cooldown` rows
  // without requiring a chained `seq`, and `audit:verify` still reports ok:true while counting
  // them as "legacy". A row inserted straight into the collection (no key needed) changes an
  // employee's Behavioural score and opens an escalation without any integrity alarm.
  it('SEC-C6 (P4-L1): an unchained (forged or legacy) cooldown row must not drive risk or escalations', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 1 });
    const m1 = first(cur.modules);
    const emp = await createEmployee(creds);
    for (let i = 0; i < 2; i += 1) {
      await AuditLog.collection.insertOne({
        action: 'learning.assessment.cooldown',
        outcome: 'success',
        severity: 'warning',
        actorId: new Types.ObjectId(emp.id),
        actorRole: 'employee',
        targetType: 'user',
        targetId: new Types.ObjectId(emp.id),
        metadata: { assessmentId: m1.quizId, kind: 'Quiz', failedAttempts: 3 },
        createdAt: new Date(),
      });
    }
    await t.g.risk.recomputeForUser(emp.id, { type: 'reconcile' });
    expect(await Escalation.countDocuments({ userId: emp.id })).toBe(0);
  });

  // P4-L2: the tip read sorts every row that has a `seq` field of ANY BSON type. One row whose seq
  // is a string (anyone with collection write access, the attacker the chain is meant to survive)
  // becomes the permanent tip; every later write fails, and since login fails closed on an audit
  // error, nobody can sign in. Integrity tampering is turned into an outage.
  it('SEC-C7 (P4-L2): a non-numeric seq planted in the collection must not stop every audit write', async () => {
    await audit.record({ action: 'auth.logout', outcome: 'success' });
    await AuditLog.collection.insertOne({
      seq: 'zzz',
      action: 'auth.logout',
      outcome: 'success',
      createdAt: new Date(),
    });
    await expect(
      audit.record({ action: 'auth.logout', outcome: 'success' }),
    ).resolves.toMatchObject({ duplicate: false });
  });

  // P4-L3: sanitizeMetadata runs before toJsonValue and walks a Types.ObjectId as a plain object,
  // so `{ subject: ObjectId }` is stored as `{ subject: { i0, i1, i2, i3 } }` (bson internals)
  // instead of the hex string. It hashes consistently, so the chain verifies, but the evidence is
  // silently lost. No current caller passes an ObjectId; the next one will.
  it('SEC-C8 (P4-L3): an ObjectId in metadata is stored as its hex string', async () => {
    const id = new Types.ObjectId();
    const { seq } = await audit.record({
      action: 'auth.logout',
      outcome: 'success',
      metadata: { subject: id },
    });
    const row = await AuditLog.findOne({ seq }).lean();
    expect(row?.metadata).toEqual({ subject: id.toHexString() });
  });

  // P4-L6: toJsonValue accepts strings that are not well-formed UTF-16. The HMAC is computed over
  // the lone surrogate, BSON stores U+FFFD, and the entry never verifies again: one write breaks
  // `audit:verify` at that seq permanently and masks later real tampering behind a standing break.
  // Not reachable from HTTP today (see SEC-E5), but any future caller passing request text is.
  it('SEC-C11 (P4-L6): a lone surrogate in metadata is refused or normalised, never stored unverifiable', async () => {
    let refused = false;
    try {
      await audit.record({
        action: 'auth.logout',
        outcome: 'success',
        metadata: { reference: 'REF-\ud800' },
      });
    } catch {
      refused = true;
    }
    if (refused) return;
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it('SEC-C9: canonical form is stable across key order, nested undefined, Dates, -0, unicode and a DB round trip; non-JSON is refused without consuming a seq', async () => {
    const at = new Date(Date.UTC(2026, 10, 9, 12, 0, 0, 123));
    await audit.record({
      action: 'auth.logout',
      outcome: 'success',
      metadata: {
        z: { b: 2, a: 1, u: undefined },
        a: [3, undefined, { y: at, x: 'naïve – 雪 – 🔐' }],
        n: -0,
        big: 2 ** 40,
      },
    });
    await audit.record({
      action: 'auth.logout',
      outcome: 'success',
      metadata: { a: [3, null, { x: 'naïve – 雪 – 🔐', y: at.toISOString() }], z: { a: 1, b: 2 } },
    });
    expect((await verifyAuditChain()).ok).toBe(true);
    await expect(
      audit.record({ action: 'auth.logout', outcome: 'success', metadata: { bad: Number.NaN } }),
    ).rejects.toThrow(TypeError);
    await expect(
      audit.record({
        action: 'auth.logout',
        outcome: 'success',
        metadata: { fn: () => 1 },
      }),
    ).rejects.toThrow(TypeError);
    expect((await verifyAuditChain()).tipSeq).toBe(2);
  });

  it('SEC-C10: the model refuses every non-service write path (create without chain fields, insertMany, update, delete, bulkWrite)', async () => {
    const { seq } = await audit.record({ action: 'auth.logout', outcome: 'success' });
    await expect(
      AuditLog.create({ action: 'auth.logout', outcome: 'success', createdAt: new Date() }),
    ).rejects.toThrow(/seq is required/);
    await expect(
      AuditLog.insertMany([{ action: 'auth.logout', outcome: 'success', createdAt: new Date() }]),
    ).rejects.toThrow();
    await expect(AuditLog.updateOne({ seq }, { $set: { outcome: 'failure' } })).rejects.toThrow();
    await expect(AuditLog.deleteOne({ seq })).rejects.toThrow();
    await expect(AuditLog.findOneAndUpdate({ seq }, { outcome: 'failure' })).rejects.toThrow();
    await expect(AuditLog.bulkWrite([{ deleteOne: { filter: { seq } } }])).rejects.toThrow();
    expect(await AuditLog.countDocuments()).toBe(1);
  });
});

// ------------------------------------------------------------------------------------------------
describe('XP and badge integrity', () => {
  it('SEC-X1: replayed completion hooks racing reconcile award one badge and never inflate XP', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 2 });
    await seedBadgesFor(cur);
    const m1 = first(cur.modules);
    const emp = await signedInEmployee(t.app, creds);
    const result = await passModule(emp, m1, cur.keys);
    const attemptId = result.body.attemptId as string;
    expect((await Employee.findById(emp.id).lean())?.totalXP).toBe(300);

    await Promise.all([
      ...Array.from({ length: 8 }, () =>
        t.g.hooks.onModuleCompleted({
          userId: emp.id,
          moduleId: m1.id,
          attemptId,
          attemptNumber: 1,
          score: 100,
          at: new Date(),
        }),
      ),
      ...Array.from({ length: 3 }, () => t.g.reconcile.reconcileUser(emp.id)),
      // A forged "final test passed" event cannot create XP without a passing FinalTest attempt.
      t.g.hooks.onFinalTestPassed({
        userId: emp.id,
        assessmentId: new Types.ObjectId().toHexString(),
        attemptId,
        attemptNumber: 1,
        score: 100,
        at: new Date(),
      }),
    ]);
    expect(await BadgeAward.countDocuments({ userId: emp.id })).toBe(1);
    expect((await Employee.findById(emp.id).lean())?.totalXP).toBe(300);
    expect((await emp.get('/me/badges')).body.earnedCount).toBe(1);
  });

  it('SEC-X2: unpublishing and republishing a passed module neither removes nor duplicates its XP or badge', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 2 });
    await seedBadgesFor(cur);
    const m1 = first(cur.modules);
    const emp = await signedInEmployee(t.app, creds);
    await passModule(emp, m1, cur.keys);
    await Module.collection.updateOne(
      { _id: new Types.ObjectId(m1.id) },
      { $set: { isPublished: false } },
    );
    await t.g.reconcile.reconcileUser(emp.id);
    expect((await emp.get('/me/badges')).body.earnedCount).toBe(1);
    await Module.collection.updateOne(
      { _id: new Types.ObjectId(m1.id) },
      { $set: { isPublished: true } },
    );
    await t.g.reconcile.reconcileUser(emp.id);
    const shown = await emp.get('/me/badges');
    expect(shown.body.earnedCount).toBe(1);
    const items = (shown.body as { items: { earned: boolean }[] }).items;
    expect(items.filter((i) => i.earned)).toHaveLength(1);
    expect((await emp.get('/me/xp')).body.totalXP).toBe(300);
  });

  it('SEC-X3: abandoning the first session forfeits the first-try bonus; a later perfect pass earns 200, not 300', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 1 });
    const m1 = first(cur.modules);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    const abandon = await emp.post(`/modules/${m1.id}/quiz/sessions/${session.sessionId}/abandon`);
    expect([200, 201]).toContain(abandon.status);
    const { session: s2 } = await startQuiz(emp, m1.id);
    const pass = await submitQuiz(emp, m1.id, s2, cur.keys, s2.questions.length);
    expect(pass.status).toBe(201);
    expect(pass.body.effects.xpEarned).toBe(200);
    expect((await emp.get('/me/xp')).body.totalXP).toBe(200);
  });

  it('SEC-X4: hooks and the sweeper only ever raise XP; lowering is reachable only through the forced reconcile', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 1 });
    const emp = await signedInEmployee(t.app, creds);
    await passModule(emp, first(cur.modules), cur.keys);
    await Employee.collection.updateOne(
      { _id: new Types.ObjectId(emp.id) },
      { $set: { totalXP: 99_999 } },
    );
    await t.g.reconcile.reconcileUser(emp.id);
    await t.g.sweeper.sweepOnce();
    expect((await Employee.findById(emp.id).lean())?.totalXP).toBe(99_999);
    await t.g.reconcile.reconcileUser(emp.id, { forceXp: true });
    expect((await Employee.findById(emp.id).lean())?.totalXP).toBe(300);
  });
});

// ------------------------------------------------------------------------------------------------
describe('risk scoring cannot be gamed', () => {
  it('SEC-R1: weights are exactly 30/25/30/15 and the bands are 0-39 / 40-69 / 70-100 with exact edges', () => {
    expect(RISK_WEIGHTS_BP).toEqual({
      knowledge: 3000,
      behavioural: 2500,
      simulation: 3000,
      engagement: 1500,
    });
    expect(RISK_BANDS.map((b) => [b.level, b.min, b.max])).toEqual([
      ['Low', 0, 39],
      ['Medium', 40, 69],
      ['High', 70, 100],
    ]);
    expect([0, 39, 40, 69, 70, 100].map(classifyRisk)).toEqual([
      'Low',
      'Low',
      'Medium',
      'Medium',
      'High',
      'High',
    ]);
    for (const bad of [-1, 101, 39.5, Number.NaN]) expect(() => classifyRisk(bad)).toThrow();
    const coverage = {
      knowledge: 'assessed',
      behavioural: 'assessed',
      simulation: 'disabled',
      engagement: 'assessed',
    } as const;
    // Simulation disabled: K 100, B 0, E 0 re-normalised over 7000 bp -> round(300000 / 7000) = 43.
    expect(
      computeComposite(
        { knowledge: 100, behavioural: 0, simulation: null, engagement: 0 },
        coverage,
      ),
    ).toBe(43);
    expect(
      computeComposite(
        { knowledge: 100, behavioural: 100, simulation: null, engagement: 100 },
        coverage,
      ),
    ).toBe(100);
  });

  it('SEC-R2: abandoning or letting the first attempt expire does not dodge Knowledge; it counts as zero correct', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 3 });
    const [m1, m2] = cur.modules;
    if (!m1 || !m2) throw new Error('fixture');
    const emp = await createEmployee(creds);
    await insertAttempts(emp.id, [
      {
        assessmentId: m1.quizId,
        moduleId: m1.id,
        attemptNumber: 1,
        endReason: 'abandoned',
        correct: 0,
      },
      { assessmentId: m1.quizId, moduleId: m1.id, attemptNumber: 2, correct: 5 },
      {
        assessmentId: m2.quizId,
        moduleId: m2.id,
        attemptNumber: 1,
        endReason: 'expired',
        correct: 0,
      },
      { assessmentId: m2.quizId, moduleId: m2.id, attemptNumber: 2, correct: 5 },
    ]);
    await t.g.risk.recomputeForUser(emp.id, { type: 'reconcile' });
    const profile = await RiskProfile.findOne({ userId: emp.id }).lean();
    expect(profile?.knowledgeScore).toBe(100);
    expect(profile?.riskLevel).not.toBeNull();
  });

  it('SEC-R3 (pins accepted design D4-12; finding P4-L5): with only one assessment attempted an employee stays "not assessed" whatever their conduct', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 3 });
    const m1 = first(cur.modules);
    const emp = await createEmployee(creds);
    await insertAttempts(
      emp.id,
      Array.from({ length: 6 }, (_, i) => ({
        assessmentId: m1.quizId,
        moduleId: m1.id,
        attemptNumber: i + 1,
        endReason: 'abandoned' as const,
        correct: 0,
      })),
    );
    await cooldownEntry(emp.id, m1.quizId);
    await t.g.risk.recomputeForUser(emp.id, { type: 'reconcile' });
    const profile = await RiskProfile.findOne({ userId: emp.id }).lean();
    expect(profile?.knowledgeScore).toBe(100);
    expect(profile?.behaviouralScore).toBe(75);
    expect(profile?.engagementScore).toBe(100);
    // Every computed dimension is bad, yet there is no level and no risk_level_high escalation.
    expect(profile?.riskLevel).toBeNull();
    expect(await Escalation.countDocuments({ reason: 'risk_level_high' })).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------
describe('availability', () => {
  it('SEC-D1: a failing audit task never wedges the mutex for later writers, and order is preserved', async () => {
    const m = new Mutex();
    const order: string[] = [];
    const failing = m.run(() => Promise.reject(new Error('boom')));
    const slow = m.run(async () => {
      await new Promise((r) => {
        setTimeout(r, 20);
      });
      order.push('slow');
    });
    const next = m.run(() => {
      order.push('next');
      return Promise.resolve('ok');
    });
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
    await slow;
    expect(order).toEqual(['slow', 'next']);
  });

  // P4-L4: when a reconcile keeps failing, the sweeper re-queues the marker with an upsert on a
  // document it has just deleted, so `attempts` restarts at 1 every time and MAX_ATTEMPTS (10) is
  // never reached. Because the re-queued marker is then the oldest (or only) one, a single sweep
  // reclaims and re-runs the same failing employee up to BATCH (50) times.
  it('SEC-D2 (P4-L4): a poison reconcile marker is retried at most once per sweep and parked after 10 claims', async () => {
    const emp = await createEmployee(creds);
    await ReconcileMarker.create({ userId: new Types.ObjectId(emp.id), reasons: ['risk'] });
    const reconcileUser = vi.fn(() => Promise.reject(new Error('poison')));
    const { clock, advance } = controllableClock();
    const sweeper = createSweeper({
      logger: silentLogger,
      clock,
      reconcile: { reconcileUser, reconcileAll: vi.fn() },
      escalations: { pendingAudit: () => Promise.resolve([]) } as unknown as EscalationService,
    });
    // One sweep handles the marker once, however many times it is eligible.
    const summary = await sweeper.sweepOnce();
    expect(summary.failed).toBe(1);
    expect(reconcileUser).toHaveBeenCalledTimes(1);
    // The back-off holds it back until it expires.
    await sweeper.sweepOnce();
    expect(reconcileUser).toHaveBeenCalledTimes(1);
    // Intended behaviour (finding fixed): the attempt count only grows, the marker is claimed at
    // most MAX (10) times in total, and is then parked for an operator instead of being deleted.
    for (let i = 0; i < 14; i += 1) {
      advance(2 * 3_600_000);
      await sweeper.sweepOnce();
    }
    expect(reconcileUser).toHaveBeenCalledTimes(10);
    const parked = await ReconcileMarker.findOne({ userId: emp.id }).lean();
    expect(parked?.attempts).toBe(10);
  });

  it('SEC-D3: a burst of failed logins is fully audited in a dense chain without starving a concurrent admin read', async () => {
    const t = await buildGamificationApp();
    const emp = await createEmployee(creds);
    const admin = await adminClient(t.app, creds);
    const fails = Array.from({ length: 25 }, () =>
      request(t.app)
        .post('/api/v1/auth/login')
        .send({ email: emp.email, password: 'wrong-password-x' }),
    );
    const [list] = await Promise.all([admin.get('/admin/audit-logs?limit=5'), ...fails]);
    expect(list.status).toBe(200);
    expect(await AuditLog.countDocuments({ action: 'auth.login.failed' })).toBe(25);
    expect((await verifyAuditChain()).ok).toBe(true);
  });
});
