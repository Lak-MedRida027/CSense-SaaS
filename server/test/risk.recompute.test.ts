import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { computeRiskProfile } from '@csense/shared';
import { createGamificationServices } from '../src/features/gamification/services.js';
import { loadRiskFacts } from '../src/features/risk/riskFacts.service.js';
import { RiskAssessment, RiskProfile } from '../src/models/index.js';
import { createAdmin, createEmployee, makeCredentials } from './helpers/fixtures.js';
import {
  createCurriculum,
  passModule,
  signedInEmployee,
  syncLearningIndexes,
} from './helpers/learningFixtures.js';
import { buildGamificationApp, insertAttempts } from './helpers/riskFixtures.js';
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

/** The stored profile as a plain object, for comparing with the pure engine. */
async function stored(userId: string) {
  return RiskProfile.findOne({ userId: new Types.ObjectId(userId) }).lean();
}

describe('risk recomputation', () => {
  it('RR1: after each attempt over HTTP the stored profile equals the pure result over the DB facts', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 3 });
    const emp = await signedInEmployee(t.app, creds);
    for (const m of cur.modules) {
      await passModule(emp, m, cur.keys);
      const profile = await stored(emp.id);
      const pure = computeRiskProfile(await loadRiskFacts(emp.id, { phishingEnabled: false }));
      expect(profile).toMatchObject({
        knowledgeScore: pure.scores.knowledge,
        behaviouralScore: pure.scores.behavioural,
        simulationScore: pure.scores.simulation,
        engagementScore: pure.scores.engagement,
        compositeScore: pure.compositeScore,
        riskLevel: pure.riskLevel,
        modelVersion: 1,
      });
    }
    // Three modules passed first try: Knowledge 0, Behavioural 0, Engagement 0.
    expect(await stored(emp.id)).toMatchObject({ compositeScore: 0, riskLevel: 'Low' });
  });

  it('RR2: one first attempt is not classified; two are', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 3 });
    const emp = await createEmployee(creds);
    const [m1, m2] = cur.modules;
    if (!m1 || !m2) throw new Error('fixture');
    await insertAttempts(emp.id, [
      { assessmentId: m1.quizId, moduleId: m1.id, attemptNumber: 1, correct: 5 },
    ]);
    await t.g.risk.recomputeForUser(emp.id, { type: 'reconcile' });
    expect(await stored(emp.id)).toMatchObject({
      riskLevel: null,
      compositeScore: null,
      knowledgeScore: 0,
    });

    await insertAttempts(emp.id, [
      { assessmentId: m2.quizId, moduleId: m2.id, attemptNumber: 1, correct: 5 },
    ]);
    await t.g.risk.recomputeForUser(emp.id, { type: 'reconcile' });
    const profile = await stored(emp.id);
    expect(profile?.riskLevel).not.toBeNull();
    expect(profile?.compositeScore).not.toBeNull();
    expect(profile?.rev).toBe(2);
  });

  it('RR3: an assessment is written only when something changed', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 2 });
    const emp = await createEmployee(creds);
    const [m1, m2] = cur.modules;
    if (!m1 || !m2) throw new Error('fixture');
    await insertAttempts(emp.id, [
      { assessmentId: m1.quizId, moduleId: m1.id, attemptNumber: 1, correct: 3 },
      { assessmentId: m2.quizId, moduleId: m2.id, attemptNumber: 1, correct: 3 },
    ]);
    const one = await t.g.risk.recomputeForUser(emp.id, { type: 'reconcile' });
    const two = await t.g.risk.recomputeForUser(emp.id, { type: 'reconcile' });
    expect(one.changed).toBe(true);
    expect(two).toMatchObject({ changed: false, assessmentId: null });
    expect(await RiskAssessment.countDocuments({ userId: emp.id })).toBe(1);

    // A pass moves Engagement, so it is a new assessment; recomputing again writes nothing.
    await insertAttempts(emp.id, [
      { assessmentId: m1.quizId, moduleId: m1.id, attemptNumber: 2, correct: 5 },
    ]);
    expect((await t.g.risk.recomputeForUser(emp.id, { type: 'reconcile' })).changed).toBe(true);
    expect((await t.g.risk.recomputeForUser(emp.id, { type: 'reconcile' })).changed).toBe(false);
    expect(await RiskAssessment.countDocuments({ userId: emp.id })).toBe(2);
  });

  it('RR4: concurrent recomputations with interleaved inserts converge; rev equals the writes', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 4 });
    const emp = await createEmployee(creds);
    const specs = cur.modules.map((m) => ({
      assessmentId: m.quizId,
      moduleId: m.id,
      attemptNumber: 1,
      correct: m.order % 2 === 0 ? 5 : 1,
    }));
    const recompute = () => t.g.risk.recomputeForUser(emp.id, { type: 'reconcile' });
    await Promise.all([
      insertAttempts(emp.id, specs.slice(0, 2)).then(recompute),
      recompute(),
      insertAttempts(emp.id, specs.slice(2)).then(recompute),
      recompute(),
      recompute(),
    ]);
    await recompute();
    const profile = await stored(emp.id);
    const pure = computeRiskProfile(await loadRiskFacts(emp.id, { phishingEnabled: false }));
    expect(profile).toMatchObject({
      knowledgeScore: pure.scores.knowledge,
      engagementScore: pure.scores.engagement,
      compositeScore: pure.compositeScore,
      riskLevel: pure.riskLevel,
    });
    expect(profile?.rev).toBe(await RiskAssessment.countDocuments({ userId: emp.id }));
    expect(await RiskProfile.countDocuments({ userId: emp.id })).toBe(1);
  });

  it('RR5: an administrator never gets a profile', async () => {
    const t = await buildGamificationApp();
    const admin = await createAdmin(creds);
    const outcome = await t.g.risk.recomputeForUser(admin.id, { type: 'reconcile' });
    expect(outcome).toEqual({ result: null, changed: false, assessmentId: null });
    expect(await RiskProfile.countDocuments()).toBe(0);
    expect(await t.g.risk.hasDrift(admin.id)).toBe(false);
  });

  it('RR6: Simulation is disabled while FEATURE_PHISHING is off, not_assessed when on, and a toggle is a config_change', async () => {
    const off = await buildGamificationApp();
    const cur = await createCurriculum({ count: 2 });
    const emp = await createEmployee(creds);
    const [m1, m2] = cur.modules;
    if (!m1 || !m2) throw new Error('fixture');
    await insertAttempts(emp.id, [
      { assessmentId: m1.quizId, moduleId: m1.id, attemptNumber: 1, correct: 4 },
      { assessmentId: m2.quizId, moduleId: m2.id, attemptNumber: 1, correct: 4 },
    ]);
    await off.g.risk.recomputeForUser(emp.id, { type: 'reconcile' });
    expect((await stored(emp.id))?.coverage?.simulation).toBe('disabled');

    const config = testConfig({ features: { phishing: true, continuousReview: false } });
    const on = createGamificationServices({
      config,
      clock: () => new Date(),
      logger: silentLogger,
    });
    expect(await on.risk.hasDrift(emp.id)).toBe(true);
    await on.reconcile.reconcileUser(emp.id, { trigger: { type: 'config_change' } });
    expect((await stored(emp.id))?.coverage?.simulation).toBe('not_assessed');
    const last = await RiskAssessment.findOne({ userId: emp.id })
      .sort({ computedAt: -1, _id: -1 })
      .lean();
    expect(last?.trigger.type).toBe('config_change');
  });

  it('records the inputs digest and the trigger on every assessment', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 1 });
    const emp = await signedInEmployee(t.app, creds);
    await passModule(emp, first(cur.modules), cur.keys);
    const a = await RiskAssessment.findOne({ userId: emp.id }).lean();
    expect(a?.inputsDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(a?.trigger.type).toBe('attempt');
    expect(a?.trigger.refId).not.toBeNull();
  });
});
