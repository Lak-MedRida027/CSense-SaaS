import { Types } from 'mongoose';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RISK_MODEL_VERSION, computeRiskProfile } from '@csense/shared';
import { digestFacts, loadRiskFacts } from '../src/features/risk/riskFacts.service.js';
import { AuditLog, Employee, GateRun, RiskAssessment, RiskProfile } from '../src/models/index.js';
import { parseReconcileArgs, runReconcile } from '../src/scripts/reconcileGamification.js';
import { loginOk, makeCredentials } from './helpers/fixtures.js';
import {
  HOUR_MS,
  buildGateApp,
  createGateQuestions,
  failGate,
  gateEmployee,
  passGate,
  type GateApp,
} from './helpers/gateFixtures.js';
import { syncLearningIndexes } from './helpers/learningFixtures.js';
import { verifyAuditChain } from './helpers/riskFixtures.js';

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

describe('risk model v2 (gate signals)', () => {
  it('RV1: a restriction recomputes risk with trigger critical_event and Behavioural from the gate facts', async () => {
    const e = await gateEmployee(t.app, creds);
    await failGate(t.app, e);
    const run = await GateRun.findOne({ userId: e.id }).lean();

    const profile = await RiskProfile.findOne({ userId: e.id }).lean();
    expect(profile).toMatchObject({ behaviouralScore: 100, modelVersion: RISK_MODEL_VERSION });
    expect(profile?.coverage?.behavioural).toBe('assessed');
    const assessments = await RiskAssessment.find({ userId: e.id }).lean();
    expect(assessments).toHaveLength(1);
    expect(assessments[0]?.trigger.type).toBe('critical_event');
    expect(assessments[0]?.trigger.refId?.toHexString()).toBe(run?._id.toHexString());
    expect(assessments[0]?.scores.behavioural).toBe(100);
    expect(assessments[0]?.modelVersion).toBe(2);
    // The stored result is the pure result over the database facts.
    const pure = computeRiskProfile(await loadRiskFacts(e.id, { phishingEnabled: false }));
    expect(pure.scores.behavioural).toBe(100);
  });

  it('RV1b: a clean first-try pass records gate_run with Behavioural 0', async () => {
    const e = await gateEmployee(t.app, creds);
    await passGate(t.app, e);
    const run = await GateRun.findOne({ userId: e.id }).lean();
    const assessment = await RiskAssessment.findOne({ userId: e.id }).lean();
    expect(assessment?.trigger.type).toBe('gate_run');
    expect(assessment?.trigger.refId?.toHexString()).toBe(run?._id.toHexString());
    expect((await RiskProfile.findOne({ userId: e.id }).lean())?.behaviouralScore).toBe(0);
    // A pass alone does not classify the employee: Knowledge is not assessed yet.
    expect((await RiskProfile.findOne({ userId: e.id }).lean())?.riskLevel).toBeNull();
  });

  it('RV2: gamification:reconcile upgrades v1 profiles to v2 with trigger model_upgrade', async () => {
    const e = await gateEmployee(t.app, creds);
    await passGate(t.app, e);
    // Pretend the profile was computed by model v1 (no gate signal yet).
    await RiskProfile.collection.updateOne(
      { userId: new Types.ObjectId(e.id) },
      { $set: { modelVersion: 1, behaviouralScore: null } },
    );
    const dry = await runReconcile(t.g, parseReconcileArgs(['--dry-run']));
    expect(dry.exitCode).toBe(2);
    const real = await runReconcile(t.g, parseReconcileArgs(['--reason', 'model_upgrade']));
    expect(real.exitCode).toBe(0);
    expect(await RiskProfile.findOne({ userId: e.id }).lean()).toMatchObject({
      modelVersion: 2,
      behaviouralScore: 0,
    });
    const latest = await RiskAssessment.findOne({ userId: e.id })
      .sort({ createdAt: -1, _id: -1 })
      .lean();
    expect(latest?.trigger.type).toBe('model_upgrade');
    const clean = await runReconcile(t.g, parseReconcileArgs(['--dry-run']));
    expect(clean).toMatchObject({ exitCode: 0, drifted: 0 });
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it('RV3: the inputs digest is stable under reordering of the gate facts and changes with them', async () => {
    const e = await gateEmployee(t.app, creds);
    await passGate(t.app, e);
    t.advance(13 * HOUR_MS);
    const login = await loginOk(t.app, e);
    await failGate(t.app, { ...e, token: login.accessToken });

    const facts = await loadRiskFacts(e.id, { phishingEnabled: false });
    expect(facts.gate?.runs).toHaveLength(2);
    const reversed = { ...facts, gate: { runs: [...(facts.gate?.runs ?? [])].reverse() } };
    expect(digestFacts(reversed)).toBe(digestFacts(facts));
    const fewer = { ...facts, gate: { runs: (facts.gate?.runs ?? []).slice(0, 1) } };
    expect(digestFacts(fewer)).not.toBe(digestFacts(facts));
    const none = { ...facts, gate: null };
    expect(digestFacts(none)).not.toBe(digestFacts(facts));
  });

  it('RV4: gate XP adds up over days and never decreases', async () => {
    const e = await gateEmployee(t.app, creds);
    await passGate(t.app, e);
    expect((await Employee.findById(e.id).lean())?.totalXP).toBe(10);
    t.advance(25 * HOUR_MS);
    const login = await loginOk(t.app, e);
    const second = await passGate(t.app, { ...e, token: login.accessToken });
    expect(second.xpEarned).toBe(10);
    expect((await Employee.findById(e.id).lean())?.totalXP).toBe(20);
    // XP also feeds the audit-free projection only; nothing else changed.
    expect(await AuditLog.countDocuments({ action: 'risk.level_changed' })).toBe(0);
  });
});
