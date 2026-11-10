import { Types } from 'mongoose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { attemptResultSchema } from '@csense/shared';
import { createGamificationServices } from '../src/features/gamification/services.js';
import {
  AuditLog,
  BadgeAward,
  Employee,
  Escalation,
  ReconcileMarker,
  RiskProfile,
} from '../src/models/index.js';
import { parseReconcileArgs, runReconcile } from '../src/scripts/reconcileGamification.js';
import { makeCredentials } from './helpers/fixtures.js';
import {
  completeContent,
  createCurriculum,
  signedInEmployee,
  startQuiz,
  submitQuiz,
  syncLearningIndexes,
} from './helpers/learningFixtures.js';
import {
  buildGamificationApp,
  craftHighRiskEmployee,
  seedBadgesFor,
  verifyAuditChain,
} from './helpers/riskFixtures.js';
import { silentLogger, testConfig } from './helpers/testConfig.js';

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

describe('reconcile', () => {
  it('RC1: drift in badges, XP, escalation and the audit outbox is repaired; a second run changes nothing', async () => {
    const t = await buildGamificationApp();
    const e = await craftHighRiskEmployee(t.g, creds);
    await seedBadgesFor(e.curriculum); // module 1 was passed before its badge existed

    // Drift injected through the driver: outbox flag reset, awards and XP wrong.
    await Escalation.collection.updateOne(
      { _id: new Types.ObjectId(e.escalationId) },
      { $set: { 'events.0.audited': false } },
    );
    const first1 = await t.g.reconcile.reconcileUser(e.id);
    expect(first1).toMatchObject({
      badgesAwarded: 1,
      xpChanged: true,
      xpBefore: 0,
      xpAfter: 150,
      drift: true,
    });
    expect((await Escalation.findById(e.escalationId).lean())?.events[0]?.audited).toBe(true);
    expect(await BadgeAward.countDocuments({ userId: e.id })).toBe(1);
    expect((await BadgeAward.findOne({ userId: e.id }).lean())?.source).toBe('reconcile');
    expect((await Employee.findById(e.id).lean())?.totalXP).toBe(150);

    // The escalation of a High profile vanishes.
    await Escalation.collection.deleteMany({ userId: new Types.ObjectId(e.id) });
    const second = await t.g.reconcile.reconcileUser(e.id);
    expect(second).toMatchObject({ escalationRepaired: true, drift: true });
    expect(await Escalation.countDocuments({ userId: e.id, active: true })).toBe(1);
    const repaired = first(await Escalation.find({ userId: e.id }).lean());
    expect(repaired.events.every((ev) => ev.audited)).toBe(true);
    expect(
      await AuditLog.countDocuments({ targetId: repaired._id, action: 'escalation.opened' }),
    ).toBe(1);

    // A level-change audit entry that was never written.
    await AuditLog.collection.deleteMany({ action: 'risk.level_changed' });
    const third = await t.g.reconcile.reconcileUser(e.id);
    expect(third.auditWritten).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'risk.level_changed' })).toBe(1);

    const settled = await t.g.reconcile.reconcileUser(e.id);
    expect(settled).toMatchObject({
      badgesAwarded: 0,
      xpChanged: false,
      riskRecomputed: false,
      escalationRepaired: false,
      assessmentRepaired: false,
      auditWritten: 0,
      drift: false,
    });
    expect(await RiskProfile.countDocuments({ userId: e.id })).toBe(1);
  });

  it('RC2: a dry run reports the drift and writes nothing, not even audit entries', async () => {
    const t = await buildGamificationApp();
    const e = await craftHighRiskEmployee(t.g, creds);
    await seedBadgesFor(e.curriculum);
    await Escalation.collection.deleteMany({ userId: new Types.ObjectId(e.id) });
    const before = {
      awards: await BadgeAward.countDocuments(),
      audit: await AuditLog.countDocuments(),
      escalations: await Escalation.countDocuments(),
      xp: (await Employee.findById(e.id).lean())?.totalXP,
    };
    const diff = await t.g.reconcile.reconcileUser(e.id, { dryRun: true });
    expect(diff).toMatchObject({
      drift: true,
      badgesAwarded: 1,
      xpChanged: true,
      escalationRepaired: true,
    });
    expect({
      awards: await BadgeAward.countDocuments(),
      audit: await AuditLog.countDocuments(),
      escalations: await Escalation.countDocuments(),
      xp: (await Employee.findById(e.id).lean())?.totalXP,
    }).toEqual(before);
  });

  it('RC3: --force-xp lowers an inflated total; the default mode never lowers it', async () => {
    const t = await buildGamificationApp();
    const e = await craftHighRiskEmployee(t.g, creds);
    await t.g.reconcile.reconcileUser(e.id); // settles at 150
    await Employee.collection.updateOne(
      { _id: new Types.ObjectId(e.id) },
      { $set: { totalXP: 5000, level: 'Defender' } },
    );
    const normal = await t.g.reconcile.reconcileUser(e.id);
    expect(normal.xpChanged).toBe(false);
    expect((await Employee.findById(e.id).lean())?.totalXP).toBe(5000);
    const forced = await t.g.reconcile.reconcileUser(e.id, { forceXp: true });
    expect(forced).toMatchObject({ xpChanged: true, xpBefore: 5000, xpAfter: 150 });
    expect(await Employee.findById(e.id).lean()).toMatchObject({
      totalXP: 150,
      level: 'Apprentice',
    });
  });

  it('RC4: a hook failure leaves the submission at 201 with XP and badge, a marker, and the sweeper repairs the profile', async () => {
    const g = createGamificationServices({
      config: testConfig(),
      clock: () => new Date(),
      logger: silentLogger,
    });
    const t = await buildGamificationApp({}, { gamification: g });
    const cur = await createCurriculum({ count: 2 });
    await seedBadgesFor(cur);
    const m1 = first(cur.modules);
    const emp = await signedInEmployee(t.app, creds);
    const spy = vi.spyOn(g.risk, 'recomputeForUser').mockRejectedValueOnce(new Error('risk down'));
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    const res = await submitQuiz(emp, m1.id, session, cur.keys, 5);
    spy.mockRestore();
    expect(res.status).toBe(201);
    const dto = attemptResultSchema.parse(res.body);
    expect(dto.effects.xpEarned).toBe(300);
    expect(dto.effects.badge?.name).toBe('Badge 1');
    expect(await RiskProfile.countDocuments({ userId: emp.id })).toBe(0);
    const marker = await ReconcileMarker.findOne({ userId: emp.id }).lean();
    expect(marker?.reasons).toEqual(['risk']);

    const summary = await g.sweeper.sweepOnce();
    expect(summary).toMatchObject({ reconciled: 1, failed: 0 });
    expect(await ReconcileMarker.countDocuments()).toBe(0);
    expect(await RiskProfile.findOne({ userId: emp.id }).lean()).toMatchObject({
      knowledgeScore: 0,
    });
  });

  it('RC4b: a failing XP concern does not drop the badge, and vice versa', async () => {
    const g = createGamificationServices({
      config: testConfig(),
      clock: () => new Date(),
      logger: silentLogger,
    });
    const t = await buildGamificationApp({}, { gamification: g });
    const cur = await createCurriculum({ count: 1 });
    await seedBadgesFor(cur);
    const m1 = first(cur.modules);
    const emp = await signedInEmployee(t.app, creds);
    const spy = vi.spyOn(g.xp, 'recomputeXp').mockRejectedValueOnce(new Error('xp down'));
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    const res = await submitQuiz(emp, m1.id, session, cur.keys, 5);
    spy.mockRestore();
    expect(res.status).toBe(201);
    expect(res.body.effects.badge?.name).toBe('Badge 1');
    expect(res.body.effects.xpEarned).toBeUndefined();
    expect((await ReconcileMarker.findOne({ userId: emp.id }).lean())?.reasons).toEqual(['xp']);
    await g.sweeper.sweepOnce();
    expect((await Employee.findById(emp.id).lean())?.totalXP).toBe(300);
  });

  it('RC5: the CLI records a run, parses its arguments and exits 2 on dry-run drift', async () => {
    const t = await buildGamificationApp();
    const e = await craftHighRiskEmployee(t.g, creds);
    await seedBadgesFor(e.curriculum);

    const dry = await runReconcile(t.g, parseReconcileArgs(['--dry-run']));
    expect(dry.exitCode).toBe(2);
    expect(dry).toMatchObject({ users: 1, drifted: 1 });
    expect(await AuditLog.countDocuments({ action: 'maintenance.reconcile_run' })).toBe(0);

    const real = await runReconcile(
      t.g,
      parseReconcileArgs(['--user', e.id, '--reason', 'config_change']),
    );
    expect(real.exitCode).toBe(0);
    const entry = await AuditLog.findOne({ action: 'maintenance.reconcile_run' }).lean();
    expect(entry?.metadata).toMatchObject({
      scope: 'user',
      dryRun: false,
      reason: 'config_change',
    });
    expect(entry?.metadata?.counts).toMatchObject({ users: 1, drifted: 1, badges: 1 });

    const clean = await runReconcile(t.g, parseReconcileArgs(['--dry-run']));
    expect(clean).toMatchObject({ exitCode: 0, drifted: 0 });
    expect((await verifyAuditChain()).ok).toBe(true);

    for (const bad of [['--nope'], ['--user'], ['--user', 'xyz'], ['--reason', 'whatever']]) {
      expect(() => parseReconcileArgs(bad), bad.join(' ')).toThrow();
    }
  });
});
