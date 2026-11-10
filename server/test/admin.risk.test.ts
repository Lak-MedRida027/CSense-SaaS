import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { RISK_WEIGHTS_BP, riskProfileDetailSchema, riskProfileListSchema } from '@csense/shared';
import { Employee, RiskAssessment, RiskProfile } from '../src/models/index.js';
import { createAdmin, makeCredentials } from './helpers/fixtures.js';
import { syncLearningIndexes } from './helpers/learningFixtures.js';
import {
  adminClient,
  buildGamificationApp,
  craftHighRiskEmployee,
} from './helpers/riskFixtures.js';

let creds: { password: string; hash: string };

beforeAll(async () => {
  creds = await makeCredentials();
  await syncLearningIndexes();
});

async function employeeWithProfile(
  name: string,
  department: string,
  profile: { composite: number; level: 'Low' | 'Medium' | 'High'; computedAt: Date } | null,
): Promise<string> {
  const emp = await Employee.create({
    name,
    email: `${name.toLowerCase()}@example.com`,
    passwordHash: creds.hash,
    department,
    createdBy: new Types.ObjectId(),
  });
  if (profile) {
    await RiskProfile.create({
      userId: emp._id,
      knowledgeScore: profile.composite,
      behaviouralScore: profile.composite,
      simulationScore: null,
      engagementScore: profile.composite,
      compositeScore: profile.composite,
      riskLevel: profile.level,
      rev: 1,
      modelVersion: 1,
      computedAt: profile.computedAt,
    });
  }
  return emp.id;
}

describe('GET /admin/risk-profiles', () => {
  it('AR1: sorted by composite descending; filters, pagination and totals', async () => {
    const t = await buildGamificationApp();
    const admin = await adminClient(t.app, creds);
    const now = Date.now();
    const a = await employeeWithProfile('Alice', 'Sales', {
      composite: 72,
      level: 'High',
      computedAt: new Date(now - 3000),
    });
    const b = await employeeWithProfile('Bob', 'Sales', {
      composite: 55,
      level: 'Medium',
      computedAt: new Date(now - 1000),
    });
    const c = await employeeWithProfile('Carol', 'IT', {
      composite: 28,
      level: 'Low',
      computedAt: new Date(now - 2000),
    });
    const d = await employeeWithProfile('Dave', 'IT', null);

    const ids = (body: { items: { userId: string }[] }) => body.items.map((i) => i.userId);
    const list = riskProfileListSchema.parse((await admin.get('/admin/risk-profiles')).body);
    expect(ids(list)).toEqual([a, b, c, d]);
    expect(list).toMatchObject({ total: 4, page: 1, pageSize: 25 });
    expect(list.items[0]).toMatchObject({
      riskLevel: 'High',
      governanceState: 'Red',
      compositeScore: 72,
    });
    expect(list.items[3]).toMatchObject({
      riskLevel: null,
      governanceState: null,
      compositeScore: null,
    });
    expect(list.items[3]?.coverage.knowledge).toBe('not_assessed');

    expect(ids((await admin.get('/admin/risk-profiles?level=High')).body)).toEqual([a]);
    expect(ids((await admin.get('/admin/risk-profiles?level=unassessed')).body)).toEqual([d]);
    expect(ids((await admin.get('/admin/risk-profiles?department=Sales')).body)).toEqual([a, b]);
    expect(ids((await admin.get('/admin/risk-profiles?sort=composite_asc')).body)).toEqual([
      c,
      b,
      a,
      d,
    ]);
    expect(ids((await admin.get('/admin/risk-profiles?sort=name_asc')).body)).toEqual([a, b, c, d]);
    expect(
      ids((await admin.get('/admin/risk-profiles?sort=computed_desc')).body).slice(0, 3),
    ).toEqual([b, c, a]);
    const page2 = (await admin.get('/admin/risk-profiles?pageSize=2&page=2')).body;
    expect(ids(page2)).toEqual([c, d]);
    expect(page2.total).toBe(4);

    for (const bad of [
      'level=Severe',
      'pageSize=101',
      'page=0',
      'sort=hax',
      'nope=1',
      'department[$ne]=x',
    ]) {
      expect((await admin.get(`/admin/risk-profiles?${bad}`)).status, bad).toBe(400);
    }
  });

  it('excludes administrators from the list', async () => {
    const t = await buildGamificationApp();
    const admin = await adminClient(t.app, creds);
    await employeeWithProfile('Erin', 'IT', null);
    expect((await admin.get('/admin/risk-profiles')).body.total).toBe(1);
  });
});

describe('GET /admin/users/:userId/risk-profile', () => {
  it('AR2: profile, evidence, history (newest first, at most 20) and escalations', async () => {
    const t = await buildGamificationApp();
    const e = await craftHighRiskEmployee(t.g, creds);
    const admin = await adminClient(t.app, creds);
    const base = await RiskAssessment.findOne({ userId: e.id }).lean();
    if (!base) throw new Error('fixture');
    for (let i = 0; i < 24; i += 1) {
      await RiskAssessment.create({
        userId: base.userId,
        profileRev: 2 + i,
        modelVersion: 1,
        scores: base.scores,
        compositeScore: base.compositeScore ?? null,
        riskLevel: base.riskLevel ?? null,
        previousLevel: base.riskLevel ?? null,
        levelChanged: false,
        coverage: base.coverage,
        effectiveWeightsBp: base.effectiveWeightsBp,
        evidence: base.evidence,
        inputsDigest: 'b'.repeat(64),
        trigger: { type: 'reconcile', refId: null },
        computedAt: new Date(base.computedAt.getTime() + (i + 1) * 1000),
      });
    }
    const res = await admin.get(`/admin/users/${e.id}/risk-profile`);
    expect(res.status).toBe(200);
    const dto = riskProfileDetailSchema.parse(res.body);
    expect(dto.profile).toMatchObject({
      userId: e.id,
      compositeScore: 71,
      riskLevel: 'High',
      governanceState: 'Red',
      scores: { knowledge: 100, behavioural: 25, simulation: null, engagement: 88 },
      coverage: { simulation: 'disabled', knowledge: 'assessed' },
      modelVersion: 1,
      effectiveWeightsBp: { knowledge: 4286, behavioural: 3571, simulation: 0, engagement: 2143 },
      nominalWeightsBp: { ...RISK_WEIGHTS_BP },
    });
    expect(dto.profile.evidence).toMatchObject({
      abandoned: 2,
      passedModules: 1,
      curriculumSize: 8,
    });
    expect(dto.history).toHaveLength(20);
    const times = dto.history.map((h) => h.computedAt);
    expect(times).toEqual([...times].sort().reverse());
    expect(dto.escalations).toHaveLength(1);
    expect(dto.escalations[0]).toMatchObject({
      id: e.escalationId,
      status: 'open',
      reason: 'risk_level_high',
    });
  });

  it('AR3: an employee without a profile is "not assessed"; admin ids and unknown ids are 404; a bad id is 400', async () => {
    const t = await buildGamificationApp();
    const admin = await adminClient(t.app, creds);
    const fresh = await employeeWithProfile('Frank', 'IT', null);
    const res = await admin.get(`/admin/users/${fresh}/risk-profile`);
    expect(res.status).toBe(200);
    const dto = riskProfileDetailSchema.parse(res.body);
    expect(dto.profile).toMatchObject({
      compositeScore: null,
      riskLevel: null,
      evidence: null,
      effectiveWeightsBp: null,
    });
    expect(dto.history).toEqual([]);
    expect(dto.escalations).toEqual([]);

    const otherAdmin = await createAdmin(creds);
    expect((await admin.get(`/admin/users/${otherAdmin.id}/risk-profile`)).status).toBe(404);
    expect(
      (await admin.get(`/admin/users/${new Types.ObjectId().toHexString()}/risk-profile`)).status,
    ).toBe(404);
    expect((await admin.get('/admin/users/nope/risk-profile')).status).toBe(400);
    expect((await admin.get(`/admin/users/${fresh}/risk-profile?x=1`)).status).toBe(400);
  });

  it('AR4: responses never carry credentials or e-mail addresses', async () => {
    const t = await buildGamificationApp();
    const e = await craftHighRiskEmployee(t.g, creds);
    const admin = await adminClient(t.app, creds);
    const list = JSON.stringify((await admin.get('/admin/risk-profiles')).body);
    const detail = JSON.stringify((await admin.get(`/admin/users/${e.id}/risk-profile`)).body);
    for (const body of [list, detail]) {
      expect(body).not.toMatch(/passwordHash|@example\.com|"email"|\$2[aby]\$/);
    }
  });

  it('reads never recompute: a stale stored profile is returned as it is', async () => {
    const t = await buildGamificationApp();
    const e = await craftHighRiskEmployee(t.g, creds);
    await RiskProfile.updateOne(
      { userId: e.id },
      { $set: { compositeScore: 5, riskLevel: 'Low' } },
    );
    const admin = await adminClient(t.app, creds);
    const dto = riskProfileDetailSchema.parse(
      (await admin.get(`/admin/users/${e.id}/risk-profile`)).body,
    );
    expect(dto.profile).toMatchObject({ compositeScore: 5, riskLevel: 'Low' });
  });
});
