import { beforeAll, describe, expect, it } from 'vitest';
import {
  RISK_BANDS,
  RISK_WEIGHTS,
  RISK_WEIGHTS_BP,
  assessmentSessionSchema,
  auditLogListSchema,
  escalationDetailSchema,
  escalationListSchema,
  myBadgesSchema,
  riskProfileDetailSchema,
  xpSummarySchema,
  type AssessmentSessionDTO,
} from '@csense/shared';
import type { GamificationServices } from '../src/features/gamification/services.js';
import { BadgeAward, Module, Quiz } from '../src/models/index.js';
import { allRoutes } from '../src/routes.js';
import { seedBadges } from '../src/scripts/seedBadges.js';
import { seedLearningContent } from '../src/scripts/seedLearning.js';
import {
  createAdmin,
  login,
  loginOk,
  makeCredentials,
  randomPassword,
  uniqueEmail,
  type TestApp,
} from './helpers/fixtures.js';
import {
  answersFor,
  clientFor,
  loadKeys,
  syncLearningIndexes,
  type Client,
} from './helpers/learningFixtures.js';
import { buildGamificationApp, verifyAuditChain } from './helpers/riskFixtures.js';

/**
 * The Phase 4 gate: weights and bands, XP and badge exactly once, no farming, a crafted high-risk
 * employee that produces an escalation with an audit trail, the response trail, and authorisation.
 * Real seed (with badges), real administrator-created employees, real HTTP.
 */
describe('Phase 4 gate journey', () => {
  let t: TestApp & { g: GamificationServices };
  let admin: Client;
  let e1: Client;
  let e2: Client;
  let moduleIds: string[] = [];
  const keys = new Map<string, number>();

  async function createEmployeeVia(adminClient: Client, app: TestApp['app']): Promise<Client> {
    const password = randomPassword();
    const email = uniqueEmail('gate');
    const created = await adminClient.post('/admin/users', {
      name: 'Gate Employee',
      email,
      password,
      role: 'employee',
    });
    expect(created.status).toBe(201);
    const { res, body } = await login(app, { email, password });
    expect(res.status).toBe(200);
    return clientFor(app, { id: created.body.id as string, email }, body.accessToken);
  }

  const startQuiz = async (c: Client, moduleId: string): Promise<AssessmentSessionDTO> => {
    const res = await c.post(`/modules/${moduleId}/quiz/sessions`);
    expect(res.status).toBe(201);
    return assessmentSessionSchema.parse(res.body);
  };

  const submit = (c: Client, moduleId: string, s: AssessmentSessionDTO, correct: number) =>
    c.post(`/modules/${moduleId}/quiz/attempts`, {
      sessionId: s.sessionId,
      answers: answersFor(s, keys, correct),
    });

  /** Start the module and answer exactly `correctCount` exercises on the first try (the rest wrongly). */
  async function doContent(c: Client, moduleId: string, correctCount: number): Promise<void> {
    expect((await c.post(`/modules/${moduleId}/start`)).status).toBe(200);
    const mod = await Module.findById(moduleId).select('+exercises.correctAnswer').lean<{
      exercises: {
        exerciseId: { toHexString(): string };
        correctAnswer: number;
        options: string[];
      }[];
    }>();
    let right = 0;
    for (const ex of mod?.exercises ?? []) {
      const useCorrect = right < correctCount;
      right += useCorrect ? 1 : 0;
      const selectedIndex = useCorrect
        ? ex.correctAnswer
        : (ex.correctAnswer + 1) % ex.options.length;
      const res = await c.post(
        `/modules/${moduleId}/exercises/${ex.exerciseId.toHexString()}/answers`,
        {
          selectedIndex,
        },
      );
      expect(res.status).toBe(200);
    }
    expect((await c.post(`/modules/${moduleId}/content/complete`)).status).toBe(200);
  }

  const xp = async (c: Client) => xpSummarySchema.parse((await c.get('/me/xp')).body);

  beforeAll(async () => {
    await syncLearningIndexes();
    await seedLearningContent({ nodeEnv: 'test' });
    expect(await seedBadges({ nodeEnv: 'test' })).toMatchObject({ created: 7 });
    for (const q of await Quiz.find({}).select('_id').lean()) {
      for (const [id, k] of await loadKeys(q._id.toHexString())) keys.set(id, k);
    }
    const built = await buildGamificationApp();
    t = built;
    const creds = await makeCredentials();
    const adminUser = await createAdmin(creds);
    admin = clientFor(t.app, adminUser, (await loginOk(t.app, adminUser)).accessToken);
    e1 = await createEmployeeVia(admin, t.app);
    e2 = await createEmployeeVia(admin, t.app);
    moduleIds = (
      await Module.find({ isPublished: true }).sort({ order: 1 }).select('_id').lean()
    ).map((m) => m._id.toHexString());
    expect(moduleIds).toHaveLength(7);
  });

  it('walks the whole gate', async () => {
    const [m1 = '', m2 = ''] = moduleIds;

    // 1. Weights and bands: the exact constants (the exhaustive suites run in the shared project).
    expect(RISK_WEIGHTS).toStrictEqual({
      knowledge: 0.3,
      behavioural: 0.25,
      simulation: 0.3,
      engagement: 0.15,
    });
    expect(RISK_WEIGHTS_BP).toStrictEqual({
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

    // 2. Completing module 1 awards XP and a badge.
    expect(await xp(e1)).toMatchObject({ totalXP: 0, level: 'Apprentice' });
    await doContent(e1, m1, 0);
    const s1 = await startQuiz(e1, m1);
    const passed = await submit(e1, m1, s1, s1.questions.length);
    expect(passed.status).toBe(201);
    expect(passed.body.effects.xpEarned).toBe(300);
    expect(passed.body.effects.badge).toMatchObject({ name: 'First Steps', iconMotif: 'welcome' });
    expect(await xp(e1)).toMatchObject({ totalXP: 300, level: 'Aware', nextLevel: 'Practitioner' });
    const badges = myBadgesSchema.parse((await e1.get('/me/badges')).body);
    expect(badges).toMatchObject({ earnedCount: 1, totalCount: 7 });
    expect(badges.items.map((b) => b.name)).toEqual([
      'First Steps',
      'Key Keeper',
      'Phish Spotter',
      'Pretext Proof',
      'Safe Clicker',
      'Device Protector',
      'First Responder',
    ]);

    // 3. Exactly once: replay, then the hooks redelivered.
    const replay = await submit(e1, m1, s1, s1.questions.length);
    expect(replay.status).toBe(409);
    expect((await xp(e1)).totalXP).toBe(300);
    expect(await BadgeAward.countDocuments({ userId: e1.id })).toBe(1);
    const again = await t.g.hooks.onModuleCompleted({
      userId: e1.id,
      moduleId: m1,
      attemptId: passed.body.attemptId as string,
      attemptNumber: 1,
      score: 100,
      at: new Date(),
    });
    expect(again?.xpEarned).toBe(300);
    expect((await xp(e1)).totalXP).toBe(300);
    expect(await BadgeAward.countDocuments({ userId: e1.id })).toBe(1);

    // 4. Retries do not farm: module 2 has 4 exercises, 2 answered correctly first time.
    await doContent(e1, m2, 2);
    for (let i = 0; i < 3; i += 1) {
      const s = await startQuiz(e1, m2);
      const failed = await submit(e1, m2, s, 1);
      expect(failed.status).toBe(201);
      expect(failed.body.passed).toBe(false);
      expect(failed.body.effects).toEqual({});
    }
    expect((await xp(e1)).totalXP).toBe(300);
    const s2 = await startQuiz(e1, m2);
    const second = await submit(e1, m2, s2, 4);
    expect(second.body).toMatchObject({ passed: true, score: 80 });
    expect(second.body.effects.xpEarned).toBe(170); // 150 completion + 2 x 10 practice
    expect((await xp(e1)).totalXP).toBe(470);

    // 5. A crafted high-risk employee: K 100, B 25, S disabled, E 88 -> 71 High.
    await doContent(e2, m1, 0);
    const abandonedFirst = await startQuiz(e2, m1);
    expect(
      (await e2.post(`/modules/${m1}/quiz/sessions/${abandonedFirst.sessionId}/abandon`)).status,
    ).toBe(201);
    const failSession = await startQuiz(e2, m1);
    expect((await submit(e2, m1, failSession, 1)).body.passed).toBe(false);
    const passSession = await startQuiz(e2, m1);
    expect((await submit(e2, m1, passSession, 4)).body.passed).toBe(true);
    await doContent(e2, m2, 0);
    const abandonedSecond = await startQuiz(e2, m2);
    expect(
      (await e2.post(`/modules/${m2}/quiz/sessions/${abandonedSecond.sessionId}/abandon`)).status,
    ).toBe(201);

    const active = escalationListSchema.parse(
      (await admin.get('/admin/escalations?status=active')).body,
    );
    expect(active.items).toHaveLength(1);
    const esc = active.items[0];
    expect(esc).toMatchObject({
      reason: 'risk_level_high',
      severity: 'elevated',
      reviewTier: 'security_team',
      status: 'open',
      riskLevel: 'High',
      compositeScore: 71,
      subject: { userId: e2.id },
    });
    expect(active.counts).toEqual({ open: 1, acknowledged: 0 });
    const escalationId = esc?.id ?? '';

    const profile = riskProfileDetailSchema.parse(
      (await admin.get(`/admin/users/${e2.id}/risk-profile`)).body,
    );
    expect(profile.profile).toMatchObject({
      compositeScore: 71,
      riskLevel: 'High',
      governanceState: 'Red',
      scores: { knowledge: 100, behavioural: 25, simulation: null, engagement: 88 },
    });
    expect(profile.profile.coverage.simulation).toBe('disabled');
    expect(profile.profile.nominalWeightsBp).toStrictEqual({ ...RISK_WEIGHTS_BP });
    expect(profile.escalations.map((x) => x.id)).toEqual([escalationId]);

    const trail = auditLogListSchema.parse(
      (await admin.get(`/admin/audit-logs?targetId=${escalationId}`)).body,
    );
    expect(trail.items.map((i) => i.action)).toEqual(['escalation.opened']);
    expect(trail.items[0]?.metadata).toMatchObject({
      subjectUserId: e2.id,
      riskLevel: 'High',
      compositeScore: 71,
    });
    const levelChange = auditLogListSchema.parse(
      (await admin.get(`/admin/audit-logs?targetId=${e2.id}&action=risk.level_changed`)).body,
    );
    expect(levelChange.items.at(0)).toMatchObject({ severity: 'warning' });

    // The first employee, who did the work properly, is not escalated.
    expect(await xp(e2)).toMatchObject({ totalXP: 150 + 0 });
    expect((await admin.get(`/admin/users/${e1.id}/risk-profile`)).body.profile.riskLevel).not.toBe(
      'High',
    );

    // 6. The response trail: acknowledge, then resolve with a note.
    const ack = await admin.patch(`/admin/escalations/${escalationId}`, {
      action: 'acknowledge',
      expectedVersion: 0,
    });
    expect(ack.status).toBe(200);
    const done = await admin.patch(`/admin/escalations/${escalationId}`, {
      action: 'resolve',
      expectedVersion: 1,
      resolution: 'remediated',
      note: 'Refresher training agreed with the line manager',
    });
    expect(escalationDetailSchema.parse(done.body)).toMatchObject({
      status: 'resolved',
      resolution: 'remediated',
    });
    const after = auditLogListSchema.parse(
      (await admin.get(`/admin/audit-logs?targetId=${escalationId}`)).body,
    );
    expect(after.items.map((i) => i.action)).toEqual([
      'escalation.resolved',
      'escalation.acknowledged',
      'escalation.opened',
    ]);
    expect(after.items.map((i) => i.actorRole)).toEqual(['administrator', 'administrator', null]);
    expect(JSON.stringify(after)).not.toContain('Refresher training');
    expect(await verifyAuditChain()).toMatchObject({ ok: true });

    // 7. Authorisation: the first employee is refused on every administrator route.
    const routes = allRoutes({ config: t.config, clock: t.clock, isReady: () => true });
    const adminOnly = routes.filter(
      (r) => r.access.kind === 'role' && r.access.roles.includes('administrator'),
    );
    expect(adminOnly.length).toBeGreaterThanOrEqual(7);
    for (const r of adminOnly) {
      const path = r.path.replace(/:[A-Za-z]+/g, escalationId);
      const res =
        r.method === 'get'
          ? await e1.get(path)
          : r.method === 'patch'
            ? await e1.patch(path, {})
            : await e1.post(path, {});
      expect(res.status, `${r.method} ${r.path}`).toBe(403);
    }
  });
});
