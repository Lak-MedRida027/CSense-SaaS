import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { riskProfileDetailSchema, riskProfileListSchema } from '@csense/shared';
import { AuditLog, Employee, Escalation, RiskProfile } from '../src/models/index.js';
import { createAdmin, createEmployee, makeCredentials } from './helpers/fixtures.js';
import { createCurriculum, syncLearningIndexes } from './helpers/learningFixtures.js';
import {
  adminClient,
  auditEntriesFor,
  buildGamificationApp,
  insertAttempts,
  verifyAuditChain,
} from './helpers/riskFixtures.js';

let creds: { password: string; hash: string };

beforeAll(async () => {
  creds = await makeCredentials();
  await syncLearningIndexes();
});

const DAY = 86_400_000;

/** An employee whose account is `ageMs` old by the given clock. */
async function employeeAged(now: Date, ageMs: number, active = true) {
  const emp = await createEmployee(creds, { isActive: active });
  await Employee.collection.updateOne(
    { _id: new Types.ObjectId(emp.id) },
    { $set: { createdAt: new Date(now.getTime() - ageMs) } },
  );
  return emp;
}

const disengagedCount = (userId?: string) =>
  Escalation.countDocuments({
    reason: 'disengaged_unassessed',
    ...(userId ? { userId } : {}),
  });

describe('P4-L5: disengagement flag', () => {
  it('DE1: exactly DISENGAGED_AFTER_DAYS old opens it; one millisecond younger does not', async () => {
    const t = await buildGamificationApp();
    await createCurriculum({ count: 2 });
    const now = t.clock();
    const edge = await employeeAged(now, 14 * DAY);
    const young = await employeeAged(now, 14 * DAY - 1);
    expect(await t.g.escalations.evaluateDisengagement(young.id)).toBeNull();
    const id = await t.g.escalations.evaluateDisengagement(edge.id);
    expect(id).not.toBeNull();
    expect(await disengagedCount()).toBe(1);

    const esc = await Escalation.findById(id).lean();
    expect(esc).toMatchObject({
      reason: 'disengaged_unassessed',
      severity: 'elevated',
      reviewTier: 'security_team',
      status: 'open',
      active: true,
      scopeKey: 'disengaged',
    });
    expect(esc?.sourceRef.type).toBe('employee_account');
    expect(esc?.userId.toHexString()).toBe(edge.id);
    const opened = (await auditEntriesFor(String(id)))[0];
    expect(opened).toMatchObject({ action: 'escalation.opened', severity: 'warning' });
    expect(opened?.metadata).toMatchObject({
      reason: 'disengaged_unassessed',
      subjectUserId: edge.id,
    });
    expect(esc?.events.every((e) => e.audited)).toBe(true);
    expect(t.notifier.escalationOpened).toHaveBeenCalledTimes(1);
    expect(t.notifier.escalationOpened).toHaveBeenCalledWith({
      escalationId: String(id),
      reason: 'disengaged_unassessed',
      severity: 'elevated',
      reviewTier: 'security_team',
    });
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it('DE2: the threshold is configurable', async () => {
    const t = await buildGamificationApp({ governance: { disengagedAfterDays: 3 } });
    await createCurriculum({ count: 1 });
    const emp = await employeeAged(t.clock(), 3 * DAY);
    expect(await t.g.escalations.evaluateDisengagement(emp.id)).not.toBeNull();
  });

  it('DE3: deactivated employees, administrators and unknown ids are never flagged', async () => {
    const t = await buildGamificationApp();
    await createCurriculum({ count: 1 });
    const off = await employeeAged(t.clock(), 30 * DAY, false);
    const admin = await createAdmin(creds);
    await Employee.db
      .collection('users')
      .updateOne(
        { _id: new Types.ObjectId(admin.id) },
        { $set: { createdAt: new Date(t.clock().getTime() - 30 * DAY) } },
      );
    expect(await t.g.escalations.evaluateDisengagement(off.id)).toBeNull();
    expect(await t.g.escalations.evaluateDisengagement(admin.id)).toBeNull();
    expect(
      await t.g.escalations.evaluateDisengagement(new Types.ObjectId().toHexString()),
    ).toBeNull();
    const scan = await t.g.escalations.scanDisengaged({ afterId: null, pageSize: 50 });
    expect(scan.opened).toBe(0);
    expect(await disengagedCount()).toBe(0);
  });

  it('DE4: an employee who is already assessed is not flagged; with no published module nobody is', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 2 });
    const [m1, m2] = cur.modules;
    if (!m1 || !m2) throw new Error('fixture');
    const emp = await employeeAged(t.clock(), 40 * DAY);
    await insertAttempts(emp.id, [
      {
        assessmentId: m1.quizId,
        moduleId: m1.id,
        attemptNumber: 1,
        correct: 5,
        attemptedAt: new Date(),
      },
      {
        assessmentId: m2.quizId,
        moduleId: m2.id,
        attemptNumber: 1,
        correct: 5,
        attemptedAt: new Date(),
      },
    ]);
    await t.g.risk.recomputeForUser(emp.id, { type: 'reconcile' });
    expect((await RiskProfile.findOne({ userId: emp.id }).lean())?.riskLevel).not.toBeNull();
    expect(await t.g.escalations.evaluateDisengagement(emp.id)).toBeNull();
    expect(await disengagedCount()).toBe(0);

    const idle = await employeeAged(t.clock(), 40 * DAY);
    const { Module } = await import('../src/models/index.js');
    await Module.updateMany({}, { $set: { isPublished: false } });
    expect(await t.g.escalations.evaluateDisengagement(idle.id)).toBeNull();
    expect((await t.g.escalations.scanDisengaged({ afterId: null, pageSize: 50 })).opened).toBe(0);
  });

  it('DE5: one per employee, ever: no duplicate, no auto-resolve when assessed, no reopen after resolution', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 2 });
    const [m1, m2] = cur.modules;
    if (!m1 || !m2) throw new Error('fixture');
    const emp = await employeeAged(t.clock(), 20 * DAY);
    const first = await t.g.escalations.evaluateDisengagement(emp.id);
    expect(first).not.toBeNull();
    expect(await t.g.escalations.evaluateDisengagement(emp.id)).toBeNull();
    await t.g.reconcile.reconcileUser(emp.id);
    await t.g.sweeper.sweepOnce();
    expect(await disengagedCount(emp.id)).toBe(1);
    expect(t.notifier.escalationOpened).toHaveBeenCalledTimes(1);

    // The employee finally takes two quizzes: the escalation stays until an administrator closes it.
    await insertAttempts(emp.id, [
      {
        assessmentId: m1.quizId,
        moduleId: m1.id,
        attemptNumber: 1,
        correct: 5,
        attemptedAt: new Date(),
      },
      {
        assessmentId: m2.quizId,
        moduleId: m2.id,
        attemptNumber: 1,
        correct: 5,
        attemptedAt: new Date(),
      },
    ]);
    await t.g.risk.recomputeForUser(emp.id, { type: 'reconcile' });
    const kept = await Escalation.findById(first).lean();
    expect(kept).toMatchObject({ status: 'open', active: true });

    const admin = await createAdmin(creds);
    await t.g.escalations.transition(
      String(first),
      { action: 'acknowledge', expectedVersion: 0 },
      { actorId: admin.id },
    );
    await t.g.escalations.transition(
      String(first),
      { action: 'resolve', expectedVersion: 1, resolution: 'remediated', note: 'engaged now' },
      { actorId: admin.id },
    );
    // Resolved: never reopened automatically.
    await RiskProfile.updateOne({ userId: emp.id }, { $set: { riskLevel: null } });
    await t.g.escalations.evaluateDisengagement(emp.id);
    await t.g.sweeper.sweepOnce();
    expect(await disengagedCount(emp.id)).toBe(1);
  });

  it('DE6: a risk recompute opens it for an old, still-unassessed employee', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 3 });
    const m1 = cur.modules[0];
    if (!m1) throw new Error('fixture');
    const emp = await employeeAged(t.clock(), 25 * DAY);
    await insertAttempts(emp.id, [
      {
        assessmentId: m1.quizId,
        moduleId: m1.id,
        attemptNumber: 1,
        correct: 5,
        attemptedAt: new Date(t.clock().getTime() - 24 * DAY),
      },
    ]);
    await t.g.risk.recomputeForUser(emp.id, {
      type: 'attempt',
      refId: new Types.ObjectId().toHexString(),
    });
    expect((await RiskProfile.findOne({ userId: emp.id }).lean())?.riskLevel).toBeNull();
    expect(await disengagedCount(emp.id)).toBe(1);
  });

  it('DE7: gamification:reconcile opens it, but a dry run writes nothing', async () => {
    const t = await buildGamificationApp();
    await createCurriculum({ count: 2 });
    const emp = await employeeAged(t.clock(), 21 * DAY);
    await t.g.reconcile.reconcileUser(emp.id, { dryRun: true });
    expect(await disengagedCount()).toBe(0);
    await t.g.reconcile.reconcileUser(emp.id);
    expect(await disengagedCount(emp.id)).toBe(1);
  });

  it('DE8: the sweeper scan flags old active unassessed employees and skips everyone else', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 2 });
    const [m1, m2] = cur.modules;
    if (!m1 || !m2) throw new Error('fixture');
    const now = t.clock();
    const idle = await employeeAged(now, 30 * DAY);
    const idle2 = await employeeAged(now, 15 * DAY);
    const fresh = await employeeAged(now, 2 * DAY);
    const off = await employeeAged(now, 30 * DAY, false);
    const busy = await employeeAged(now, 30 * DAY);
    await insertAttempts(busy.id, [
      {
        assessmentId: m1.quizId,
        moduleId: m1.id,
        attemptNumber: 1,
        correct: 5,
        attemptedAt: new Date(),
      },
      {
        assessmentId: m2.quizId,
        moduleId: m2.id,
        attemptNumber: 1,
        correct: 5,
        attemptedAt: new Date(),
      },
    ]);
    await t.g.risk.recomputeForUser(busy.id, { type: 'reconcile' });

    const summary = await t.g.sweeper.sweepOnce();
    expect(summary.disengaged).toBe(2);
    const flagged = (await Escalation.find({ reason: 'disengaged_unassessed' }).lean()).map((e) =>
      e.userId.toHexString(),
    );
    expect(flagged.sort()).toEqual([idle.id, idle2.id].sort());
    expect(flagged).not.toContain(fresh.id);
    expect(flagged).not.toContain(off.id);
    expect(flagged).not.toContain(busy.id);
    // A second sweep finds nothing new.
    expect((await t.g.sweeper.sweepOnce()).disengaged).toBe(0);
  });

  it('DE9: the scan is paged and bounded: pages follow the cursor and stop at the end', async () => {
    const t = await buildGamificationApp();
    await createCurriculum({ count: 2 });
    for (let i = 0; i < 5; i += 1) await employeeAged(t.clock(), 30 * DAY);
    let after: string | null = null;
    let opened = 0;
    let pages = 0;
    do {
      const page: { opened: number; next: string | null } = await t.g.escalations.scanDisengaged({
        afterId: after,
        pageSize: 2,
      });
      opened += page.opened;
      after = page.next;
      pages += 1;
    } while (after !== null && pages < 10);
    expect(opened).toBe(5);
    expect(pages).toBe(3);
    expect(await disengagedCount()).toBe(5);
    // Already-flagged employees are skipped without a second open.
    expect((await t.g.escalations.scanDisengaged({ afterId: null, pageSize: 10 })).opened).toBe(0);
  });

  it('DE10: admins see unassessedSince and disengaged; employees see nothing', async () => {
    const t = await buildGamificationApp();
    await createCurriculum({ count: 2 });
    const idle = await employeeAged(t.clock(), 30 * DAY);
    const calm = await employeeAged(t.clock(), 1 * DAY);
    await t.g.escalations.evaluateDisengagement(idle.id);
    const admin = await adminClient(t.app, creds);

    const list = riskProfileListSchema.parse((await admin.get('/admin/risk-profiles')).body);
    const byId = new Map(list.items.map((i) => [i.userId, i]));
    expect(byId.get(idle.id)).toMatchObject({ disengaged: true, riskLevel: null });
    expect(byId.get(idle.id)?.unassessedSince).toBe(
      new Date(t.clock().getTime() - 30 * DAY).toISOString(),
    );
    expect(byId.get(calm.id)).toMatchObject({ disengaged: false });
    expect(byId.get(calm.id)?.unassessedSince).not.toBeNull();

    const detail = riskProfileDetailSchema.parse(
      (await admin.get(`/admin/users/${idle.id}/risk-profile`)).body,
    );
    expect(detail.profile.disengaged).toBe(true);
    expect(detail.escalations.map((e) => e.reason)).toEqual(['disengaged_unassessed']);

    const filtered = await admin.get('/admin/escalations?reason=disengaged_unassessed');
    expect(filtered.body.total).toBe(1);

    // An employee token still reaches none of it.
    const { employeeClient } = await import('./helpers/riskFixtures.js');
    const emp = await employeeClient(t.app, creds);
    for (const path of [
      '/admin/risk-profiles',
      `/admin/users/${idle.id}/risk-profile`,
      '/admin/escalations?reason=disengaged_unassessed',
    ]) {
      expect((await emp.get(path)).status, path).toBe(403);
    }
    const xp = JSON.stringify((await emp.get('/me/xp')).body);
    expect(xp).not.toMatch(/disengaged|unassessed|escalation/i);
    expect(await AuditLog.countDocuments({ action: 'escalation.opened' })).toBe(1);
  });
});
