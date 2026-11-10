import { Types } from 'mongoose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { audit, createAuditService } from '../src/features/audit/audit.service.js';
import { Escalation, QuizAttempt, ReconcileMarker, RiskProfile } from '../src/models/index.js';
import { createAdmin, createEmployee, makeCredentials } from './helpers/fixtures.js';
import {
  completeContent,
  createCurriculum,
  signedInEmployee,
  startQuiz,
  submitQuiz,
  syncLearningIndexes,
} from './helpers/learningFixtures.js';
import {
  adminClient,
  auditEntriesFor,
  buildGamificationApp,
  craftHighRiskEmployee,
  craftedHighRiskSpecs,
  createFullCurriculum,
  insertAttempts,
  verifyAuditChain,
} from './helpers/riskFixtures.js';
import { testChainSecret } from './helpers/testConfig.js';

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

describe('risk escalation (entering High)', () => {
  it('GE1: a crafted high-risk profile opens exactly one elevated escalation with audit records', async () => {
    const t = await buildGamificationApp();
    const e = await craftHighRiskEmployee(t.g, creds);

    const profile = await RiskProfile.findOne({ userId: e.id }).lean();
    expect(profile).toMatchObject({
      knowledgeScore: 100,
      behaviouralScore: 25,
      simulationScore: null,
      engagementScore: 88,
      compositeScore: 71,
      riskLevel: 'High',
    });
    expect(profile?.coverage?.simulation).toBe('disabled');

    const escalations = await Escalation.find({ userId: e.id }).lean();
    expect(escalations).toHaveLength(1);
    const esc = first(escalations);
    expect(esc).toMatchObject({
      reason: 'risk_level_high',
      severity: 'elevated',
      reviewTier: 'security_team',
      status: 'open',
      active: true,
      version: 0,
    });
    expect(esc.context).toMatchObject({
      riskLevel: 'High',
      previousLevel: null,
      compositeScore: 71,
      modelVersion: 2,
    });
    expect(esc.events.map((ev) => [ev.type, ev.audited])).toEqual([['opened', true]]);

    const onEscalation = await auditEntriesFor(e.escalationId);
    expect(onEscalation.map((a) => a.action)).toEqual(['escalation.opened']);
    expect(onEscalation[0]).toMatchObject({ severity: 'warning', targetType: 'escalation' });
    expect(onEscalation[0]?.metadata).toMatchObject({
      subjectUserId: e.id,
      reason: 'risk_level_high',
    });
    const onUser = await auditEntriesFor(e.id);
    const changed = onUser.find((a) => a.action === 'risk.level_changed');
    expect(changed).toMatchObject({ severity: 'warning', targetType: 'user' });
    expect(changed?.metadata).toMatchObject({ from: null, to: 'High', compositeScore: 71 });

    expect(t.notifier.escalationOpened).toHaveBeenCalledTimes(1);
    expect(t.notifier.escalationOpened).toHaveBeenCalledWith({
      escalationId: e.escalationId,
      reason: 'risk_level_high',
      severity: 'elevated',
      reviewTier: 'security_team',
    });
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it('GE2: recomputing while still High adds no escalation and no audit entry', async () => {
    const t = await buildGamificationApp();
    const e = await craftHighRiskEmployee(t.g, creds);
    const before = await Promise.all([
      Escalation.countDocuments(),
      (await import('../src/models/index.js')).AuditLog.countDocuments(),
    ]);
    await t.g.risk.recomputeForUser(e.id, { type: 'reconcile' });
    await t.g.risk.recomputeForUser(e.id, { type: 'reconcile' });
    const after = await Promise.all([
      Escalation.countDocuments(),
      (await import('../src/models/index.js')).AuditLog.countDocuments(),
    ]);
    expect(after).toEqual(before);
    expect(t.notifier.escalationOpened).toHaveBeenCalledTimes(1);
  });

  /** Make the crafted employee Low by adding perfect first attempts on modules 3 to 7. */
  async function calmDown(userId: string, e: Awaited<ReturnType<typeof craftHighRiskEmployee>>) {
    const ids = await insertAttempts(
      userId,
      e.curriculum.modules
        .slice(2)
        .map((m) => ({ assessmentId: m.quizId, moduleId: m.id, attemptNumber: 1, correct: 5 })),
    );
    return async () => {
      await QuizAttempt.collection.deleteMany({
        _id: { $in: ids.map((i) => new Types.ObjectId(i)) },
      });
    };
  }

  it('GE3: High, then lower, then High again while the escalation is active retriggers it', async () => {
    const t = await buildGamificationApp();
    const e = await craftHighRiskEmployee(t.g, creds);
    const undo = await calmDown(e.id, e);
    await t.g.risk.recomputeForUser(e.id, { type: 'reconcile' });
    expect((await RiskProfile.findOne({ userId: e.id }).lean())?.riskLevel).not.toBe('High');
    expect((await RiskProfile.findOne({ userId: e.id }).lean())?.highEpisodeId).toBeNull();
    // Leaving High never resolves the escalation.
    expect(await Escalation.countDocuments({ userId: e.id, active: true })).toBe(1);

    await undo();
    await t.g.risk.recomputeForUser(e.id, { type: 'reconcile' });
    const all = await Escalation.find({ userId: e.id }).lean();
    expect(all).toHaveLength(1);
    const esc = first(all);
    expect(esc.events.map((ev) => ev.type)).toEqual(['opened', 'retriggered']);
    expect(esc.events.every((ev) => ev.audited)).toBe(true);
    expect(esc.version).toBe(1);
    expect((await auditEntriesFor(e.escalationId)).map((a) => a.action)).toEqual([
      'escalation.opened',
      'escalation.retriggered',
    ]);
    expect(t.notifier.escalationRetriggered).toHaveBeenCalledTimes(1);
    expect(t.notifier.escalationOpened).toHaveBeenCalledTimes(1);
  });

  it('GE4: after the escalation is resolved, a new entry into High opens a second one', async () => {
    const t = await buildGamificationApp();
    const e = await craftHighRiskEmployee(t.g, creds);
    const admin = await createAdmin(creds);
    await t.g.escalations.transition(
      e.escalationId,
      { action: 'acknowledge', expectedVersion: 0 },
      { actorId: admin.id },
    );
    await t.g.escalations.transition(
      e.escalationId,
      { action: 'resolve', expectedVersion: 1, resolution: 'remediated', note: 'Retrained' },
      { actorId: admin.id },
    );
    const undo = await calmDown(e.id, e);
    await t.g.risk.recomputeForUser(e.id, { type: 'reconcile' });
    await undo();
    await t.g.risk.recomputeForUser(e.id, { type: 'reconcile' });
    const all = await Escalation.find({ userId: e.id }).sort({ openedAt: 1, _id: 1 }).lean();
    expect(all).toHaveLength(2);
    expect(all.map((x) => x.status).sort()).toEqual(['open', 'resolved']);
    expect(t.notifier.escalationOpened).toHaveBeenCalledTimes(2);
  });

  it('GE5: reaching Medium is audited only; no escalation', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 2 });
    const emp = await createEmployee(creds);
    const [m1, m2] = cur.modules;
    if (!m1 || !m2) throw new Error('fixture');
    await insertAttempts(emp.id, [
      { assessmentId: m1.quizId, moduleId: m1.id, attemptNumber: 1, correct: 2 },
      { assessmentId: m2.quizId, moduleId: m2.id, attemptNumber: 1, correct: 3 },
    ]);
    await t.g.risk.recomputeForUser(emp.id, { type: 'reconcile' });
    expect(await RiskProfile.findOne({ userId: emp.id }).lean()).toMatchObject({
      compositeScore: 43,
      riskLevel: 'Medium',
    });
    expect(await Escalation.countDocuments()).toBe(0);
    const entry = (await auditEntriesFor(emp.id)).find((a) => a.action === 'risk.level_changed');
    expect(entry).toMatchObject({ severity: 'warning' });
    expect(t.notifier.escalationOpened).not.toHaveBeenCalled();
  });
});

describe('critical events', () => {
  it('GE6: a gate restriction opens a critical security-team escalation (D5-6), audited once', async () => {
    const t = await buildGamificationApp();
    const emp = await createEmployee(creds);
    const input = {
      userId: emp.id,
      reason: 'gate_access_restricted' as const,
      sourceRef: { type: 'gate_event' as const, id: new Types.ObjectId().toHexString() },
      occurredAt: new Date(),
    };
    const { escalationId } = await t.g.escalations.recordCriticalEvent(input);
    const again = await t.g.escalations.recordCriticalEvent(input);
    expect(again.escalationId).toBe(escalationId);

    const escalations = await Escalation.find({ userId: emp.id }).lean();
    expect(escalations).toHaveLength(1);
    expect(first(escalations)).toMatchObject({
      reason: 'gate_access_restricted',
      severity: 'critical',
      reviewTier: 'security_team',
      scopeKey: null,
    });
    const onUser = await auditEntriesFor(emp.id);
    expect(onUser.filter((a) => a.action === 'governance.critical_event_recorded')).toHaveLength(1);
    expect(onUser.find((a) => a.action === 'governance.critical_event_recorded')?.severity).toBe(
      'critical',
    );
    const onEsc = await auditEntriesFor(escalationId);
    expect(onEsc.map((a) => [a.action, a.severity])).toEqual([['escalation.opened', 'critical']]);
    expect(t.notifier.escalationOpened).toHaveBeenCalledTimes(1);
  });

  it('GE7: a credentials-submitted event needs the phishing flag', async () => {
    const off = await buildGamificationApp();
    const emp = await createEmployee(creds);
    const input = {
      userId: emp.id,
      reason: 'simulation_credentials_submitted' as const,
      sourceRef: { type: 'phishing_event' as const, id: new Types.ObjectId().toHexString() },
      occurredAt: new Date(),
    };
    await expect(off.g.escalations.recordCriticalEvent(input)).rejects.toThrow(/FEATURE_PHISHING/);
    expect(await Escalation.countDocuments()).toBe(0);

    const on = await buildGamificationApp({
      features: { phishing: true, continuousReview: false },
    });
    await on.g.escalations.recordCriticalEvent(input);
    expect(await Escalation.countDocuments({ reason: 'simulation_credentials_submitted' })).toBe(1);
  });
});

describe('failures never fail the submission', () => {
  it('GE8: an audit failure leaves an unaudited event and a marker; the sweeper completes it', async () => {
    const t = await buildGamificationApp();
    const spy = vi.spyOn(audit, 'record').mockImplementation((input) => {
      if (input.action === 'escalation.opened') return Promise.reject(new Error('audit down'));
      return createAuditService({ chainSecret: testChainSecret }).record(input);
    });
    try {
      const cur = await createFullCurriculum();
      const emp = await createEmployee(creds);
      await insertAttempts(emp.id, craftedHighRiskSpecs(cur));
      const attemptId = new Types.ObjectId().toHexString();
      // The hook swallows the failure: the caller (a submission) would still get its 201.
      const effects = await t.g.hooks.onAttemptRecorded({
        userId: emp.id,
        attemptId,
        kind: 'Quiz',
        assessmentId: first(cur.modules).quizId,
        moduleId: first(cur.modules).id,
        attemptNumber: 1,
        endReason: 'abandoned',
        score: 0,
        passed: false,
        correctCount: 0,
        totalCount: 5,
        at: new Date(),
      });
      expect(effects).toBeUndefined();

      const esc = first(await Escalation.find({ userId: emp.id }).lean());
      expect(esc.events.map((ev) => ev.audited)).toEqual([false]);
      expect(await ReconcileMarker.countDocuments({ userId: emp.id })).toBe(1);

      spy.mockRestore();
      const summary = await t.g.sweeper.sweepOnce();
      expect(summary.failed).toBe(0);
      const after = first(await Escalation.find({ userId: emp.id }).lean());
      expect(after.events.map((ev) => ev.audited)).toEqual([true]);
      expect(await ReconcileMarker.countDocuments()).toBe(0);
      expect((await auditEntriesFor(esc._id.toHexString())).map((a) => a.action)).toEqual([
        'escalation.opened',
      ]);
      expect((await verifyAuditChain()).ok).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('repeated assessment cooldowns', () => {
  const cooldownEntry = (userId: string, assessmentId: string, svc = audit) =>
    svc.record({
      action: 'learning.assessment.cooldown',
      outcome: 'success',
      severity: 'warning',
      actor: { id: userId, role: 'employee' },
      target: { type: 'user', id: userId },
      metadata: { assessmentId, kind: 'Quiz', failedAttempts: 3 },
    });

  it('CE1: one cooldown does nothing; the second on the same assessment opens an elevated escalation; the third retriggers', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 2 });
    const emp = await createEmployee(creds);
    const [m1, m2] = cur.modules;
    if (!m1 || !m2) throw new Error('fixture');

    await cooldownEntry(emp.id, m1.quizId);
    await cooldownEntry(emp.id, m2.quizId); // a different assessment does not add up
    await t.g.risk.recomputeForUser(emp.id, { type: 'reconcile' });
    expect(await Escalation.countDocuments({ userId: emp.id })).toBe(0);

    await cooldownEntry(emp.id, m1.quizId);
    await t.g.risk.recomputeForUser(emp.id, { type: 'reconcile' });
    const escs = await Escalation.find({ userId: emp.id }).lean();
    expect(escs).toHaveLength(1);
    const esc = first(escs);
    expect(esc).toMatchObject({
      reason: 'repeated_assessment_cooldowns',
      severity: 'elevated',
      reviewTier: 'security_team',
      status: 'open',
      scopeKey: `assessment:${m1.quizId}`,
    });
    expect(esc.sourceRef.type).toBe('audit_entry');
    const opened = (await auditEntriesFor(esc._id.toHexString()))[0];
    expect(opened).toMatchObject({ action: 'escalation.opened', severity: 'warning' });
    expect(opened?.metadata).toMatchObject({
      reason: 'repeated_assessment_cooldowns',
      assessmentId: m1.quizId,
    });
    expect(t.notifier.escalationOpened).toHaveBeenCalledTimes(1);

    // Recomputing again is a no-op (same latest cooldown).
    await t.g.risk.recomputeForUser(emp.id, { type: 'reconcile' });
    expect(first(await Escalation.find({ userId: emp.id }).lean()).events).toHaveLength(1);

    await cooldownEntry(emp.id, m1.quizId);
    await t.g.risk.recomputeForUser(emp.id, { type: 'reconcile' });
    const after = first(await Escalation.find({ userId: emp.id }).lean());
    expect(after.events.map((ev) => ev.type)).toEqual(['opened', 'retriggered']);
    expect(t.notifier.escalationRetriggered).toHaveBeenCalledTimes(1);
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it('CE2: cooldowns older than the window do not count', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 1 });
    const emp = await createEmployee(creds);
    const m1 = first(cur.modules);
    const old = createAuditService({
      chainSecret: testChainSecret,
      clock: () => new Date(Date.now() - 8 * 86_400_000),
    });
    await cooldownEntry(emp.id, m1.quizId, old);
    await cooldownEntry(emp.id, m1.quizId); // recent
    await t.g.risk.recomputeForUser(emp.id, { type: 'reconcile' });
    expect(await Escalation.countDocuments({ userId: emp.id })).toBe(0);
    await cooldownEntry(emp.id, m1.quizId); // two recent now
    await t.g.risk.recomputeForUser(emp.id, { type: 'reconcile' });
    expect(await Escalation.countDocuments({ userId: emp.id })).toBe(1);
  });

  it('CE3: the threshold is configurable', async () => {
    const t = await buildGamificationApp({ governance: { escalateAfterCooldowns: 3 } });
    const cur = await createCurriculum({ count: 1 });
    const emp = await createEmployee(creds);
    const m1 = first(cur.modules);
    await cooldownEntry(emp.id, m1.quizId);
    await cooldownEntry(emp.id, m1.quizId);
    await t.g.risk.recomputeForUser(emp.id, { type: 'reconcile' });
    expect(await Escalation.countDocuments()).toBe(0);
    await cooldownEntry(emp.id, m1.quizId);
    await t.g.risk.recomputeForUser(emp.id, { type: 'reconcile' });
    expect(await Escalation.countDocuments()).toBe(1);
  });

  it('CE4: two real cooldowns over HTTP flag the employee and raise Behavioural risk', async () => {
    const t = await buildGamificationApp({
      learning: { cooldownAfterFails: 3, cooldownMinutes: 15 },
      accessTtlSeconds: 7200,
    });
    const cur = await createCurriculum({ count: 1 });
    const m1 = first(cur.modules);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const failThree = async () => {
      for (let i = 0; i < 3; i += 1) {
        const { res, session } = await startQuiz(emp, m1.id);
        expect(res.status).toBe(201);
        expect((await submitQuiz(emp, m1.id, session, cur.keys, 1)).status).toBe(201);
      }
    };
    await failThree();
    // (The risk profile is High already, which is a separate, risk_level_high escalation.)
    expect(await Escalation.countDocuments({ reason: 'repeated_assessment_cooldowns' })).toBe(0);
    t.advance(16 * 60_000);
    await failThree();

    const escs = await Escalation.find({
      userId: emp.id,
      reason: 'repeated_assessment_cooldowns',
    }).lean();
    expect(escs).toHaveLength(1);
    const profile = await RiskProfile.findOne({ userId: emp.id }).lean();
    expect(profile?.evidence?.cooldowns).toBe(2);
    // 6 failed submissions at one quiz: 5 extra failures saturate the retry share (50), plus 2 x 25.
    expect(profile?.behaviouralScore).toBe(100);

    const admin = await adminClient(t.app, creds);
    const list = await admin.get(
      '/admin/escalations?status=active&reason=repeated_assessment_cooldowns',
    );
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    const logs = await admin.get(`/admin/audit-logs?targetId=${first(escs)._id.toHexString()}`);
    expect((logs.body.items as { action: string }[]).map((l) => l.action)).toEqual([
      'escalation.opened',
    ]);
    expect((await verifyAuditChain()).ok).toBe(true);
  });
});
