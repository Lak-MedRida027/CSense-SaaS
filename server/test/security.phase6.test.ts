/**
 * Security-tester probes for Phase 6 (plan 10, E1/E3/E4): `PATCH /me/onboarding` and the DTO change.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Employee, UserProgress } from '../src/models/index.js';
import { bearer, buildTestApp, makeCredentials } from './helpers/fixtures.js';
import { buildGateApp, gateEmployee, allKeys } from './helpers/gateFixtures.js';
import {
  completeContent,
  createCurriculum,
  passModule,
  signedInEmployee,
  startQuiz,
  syncLearningIndexes,
} from './helpers/learningFixtures.js';

let creds: Awaited<ReturnType<typeof makeCredentials>>;
beforeAll(async () => {
  creds = await makeCredentials();
  await syncLearningIndexes();
});

const URL = '/api/v1/me/onboarding';

describe('SEC6: PATCH /me/onboarding', () => {
  it('SEC6-1 IDOR: identity is the token only; ids in query/body never address another employee', async () => {
    const t = await buildGateApp();
    const a = await gateEmployee(t.app, creds);
    const b = await gateEmployee(t.app, creds);
    const viaQuery = await request(t.app)
      .patch(`${URL}?userId=${b.id}&_id=${b.id}`)
      .set(...bearer(a.token))
      .send({ outcome: 'skipped' });
    // Query is not declared for the route: either refused or ignored, never applied to B.
    expect([200, 400]).toContain(viaQuery.status);
    for (const body of [
      { outcome: 'skipped', userId: b.id },
      { outcome: 'skipped', _id: b.id },
      { outcome: 'skipped', id: b.id },
    ]) {
      const r = await request(t.app)
        .patch(URL)
        .set(...bearer(a.token))
        .send(body);
      expect(r.status).toBe(400);
    }
    expect((await Employee.findById(b.id).lean())?.onboarding ?? null).toBeNull();
  });

  it('SEC6-2 operator injection and mass assignment are 400 and store nothing', async () => {
    const t = await buildGateApp();
    const a = await gateEmployee(t.app, creds);
    const bodies: unknown[] = [
      { outcome: { $ne: null } },
      { outcome: ['completed'] },
      { 'onboarding.outcome': 'completed' },
      { $set: { totalXP: 9999 } },
      { outcome: 'completed', totalXP: 9999 },
      { outcome: 'completed', at: '1999-01-01T00:00:00.000Z' },
      { outcome: 'completed', role: 'administrator' },
      [{ outcome: 'completed' }],
      'outcome=completed',
    ];
    for (const body of bodies) {
      const r = await request(t.app)
        .patch(URL)
        .set(...bearer(a.token))
        .send(body as object);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    const urlEncoded = await request(t.app)
      .patch(URL)
      .set(...bearer(a.token))
      .type('form')
      .send('outcome=completed');
    expect(urlEncoded.status).toBe(400);
    const stored = await Employee.findById(a.id).lean();
    expect(stored?.onboarding ?? null).toBeNull();
    expect(stored?.totalXP ?? 0).toBe(0);
    expect(stored?.role).toBe('employee');
  });

  it('SEC6-3 only PATCH on the exact path exists (other verbs, case, suffixes are 404/405)', async () => {
    const t = await buildGateApp();
    const a = await gateEmployee(t.app, creds);
    for (const [m, p] of [
      ['put', URL],
      ['post', URL],
      ['delete', URL],
      ['get', URL],
      ['patch', '/api/v1/ME/onboarding'],
      ['patch', `${URL}/reset`],
      ['patch', '/api/v1/me/onboarding%2f..%2fxp'],
    ] as const) {
      const r = await request(t.app)
        [m](p)
        .set(...bearer(a.token))
        .send({ outcome: 'skipped' });
      expect(r.status, `${m} ${p}`).toBe(404);
    }
  });

  it('SEC6-4 deactivated employee is 401; response carries exactly {outcome, at}', async () => {
    const t = await buildGateApp();
    const a = await gateEmployee(t.app, creds);
    const ok = await request(t.app)
      .patch(URL)
      .set(...bearer(a.token))
      .send({ outcome: 'completed' });
    expect(ok.status).toBe(200);
    expect([...allKeys(ok.body)].sort()).toEqual(['at', 'outcome']);
    // Repeat with the other outcome: first write wins, timestamp not refreshable.
    const again = await request(t.app)
      .patch(URL)
      .set(...bearer(a.token))
      .send({ outcome: 'skipped' });
    expect(again.body).toEqual(ok.body);

    const b = await gateEmployee(t.app, creds);
    await Employee.updateOne({ _id: b.id }, { $set: { isActive: false } });
    const r = await request(t.app)
      .patch(URL)
      .set(...bearer(b.token))
      .send({ outcome: 'skipped' });
    expect(r.status).toBe(401);
    expect((await Employee.findById(b.id).lean())?.onboarding ?? null).toBeNull();
  });

  it('SEC6-5 login and /auth/me never leak passwordHash or internal fields with the new onboarding field', async () => {
    const t = await buildGateApp();
    const a = await gateEmployee(t.app, creds);
    await request(t.app)
      .patch(URL)
      .set(...bearer(a.token))
      .send({ outcome: 'completed' });
    const me = await request(t.app)
      .get('/api/v1/auth/me')
      .set(...bearer(a.token));
    expect(me.status).toBe(200);
    const keys = allKeys(me.body);
    for (const bad of ['passwordHash', '__v', '_id', 'gateRestriction', 'refreshTokens']) {
      expect(keys.has(bad), bad).toBe(false);
    }
    expect(Object.keys(me.body.onboarding).sort()).toEqual(['at', 'outcome']);
  });
});

describe('SEC6: journey routes (E1 IDOR, E2 unlock bypass, E3 replay)', () => {
  it('SEC6-6 E2: every journey mutation on a locked module is MODULE_LOCKED and writes nothing', async () => {
    const t = await buildTestApp();
    const { modules } = await createCurriculum({ count: 2, interactive: [1, 2] });
    const [, m2] = modules;
    if (!m2) throw new Error('fixture');
    const c = await signedInEmployee(t.app, creds);
    const ex = m2.exerciseIds[0] ?? '';
    const probes: [string, Awaited<ReturnType<typeof c.get>>][] = [
      ['detail', await c.get(`/modules/${m2.id}`)],
      ['start', await c.post(`/modules/${m2.id}/start`)],
      ['answer', await c.post(`/modules/${m2.id}/exercises/${ex}/answers`, { selectedIndex: 0 })],
      ['complete', await c.post(`/modules/${m2.id}/content/complete`)],
      ['session', await c.post(`/modules/${m2.id}/quiz/sessions`)],
      ['quiz', await c.get(`/modules/${m2.id}/quiz`)],
    ];
    for (const [label, r] of probes) {
      expect(r.status, label).toBe(403);
      expect(r.body.error.code, label).toBe('MODULE_LOCKED');
    }
    expect(await UserProgress.countDocuments({ userId: c.id, moduleId: m2.id })).toBe(0);
  });

  it("SEC6-7 E1: another employee cannot use, abandon or submit someone else's session", async () => {
    const t = await buildTestApp();
    const { modules, keys } = await createCurriculum({ count: 1, interactive: [1] });
    const [m1] = modules;
    if (!m1) throw new Error('fixture');
    const a = await signedInEmployee(t.app, creds);
    const b = await signedInEmployee(t.app, creds);
    await completeContent(a, m1);
    await completeContent(b, m1);
    const { session } = await startQuiz(a, m1.id);
    const abandon = await b.post(`/modules/${m1.id}/quiz/sessions/${session.sessionId}/abandon`);
    expect([403, 404, 409]).toContain(abandon.status);
    const submit = await b.post(`/modules/${m1.id}/quiz/attempts`, {
      sessionId: session.sessionId,
      answers: session.questions.map((q) => ({
        questionId: q.questionId,
        selectedIndex: keys.get(q.questionId) ?? 0,
      })),
    });
    expect([403, 404, 409]).toContain(submit.status);
    // A's session still usable by A.
    const ok = await a.post(`/modules/${m1.id}/quiz/attempts`, {
      sessionId: session.sessionId,
      answers: session.questions.map((q) => ({
        questionId: q.questionId,
        selectedIndex: keys.get(q.questionId) ?? 0,
      })),
    });
    expect(ok.status).toBe(201);
  });

  it('SEC6-8 E3/E4/E13: completeContent without watching yields no XP; replays never change XP after a pass', async () => {
    const t = await buildTestApp();
    const { modules, keys } = await createCurriculum({ count: 2 }); // video modules, no exercises
    const [m1] = modules;
    if (!m1) throw new Error('fixture');
    const c = await signedInEmployee(t.app, creds);
    await c.post(`/modules/${m1.id}/start`);
    // E13: a modified client finishes the lesson at once (no watch evidence exists server-side).
    const done = await c.post(`/modules/${m1.id}/content/complete`);
    expect(done.status).toBe(200);
    const xp0 = (await c.get('/me/xp')).body.totalXP;
    expect(xp0).toBe(0);
    await passModule(c, m1, keys);
    const xp1 = (await c.get('/me/xp')).body.totalXP;
    for (let i = 0; i < 3; i++) {
      await c.post(`/modules/${m1.id}/start`);
      await c.post(`/modules/${m1.id}/content/complete`);
      const again = await c.post(`/modules/${m1.id}/quiz/sessions`);
      expect(again.status).toBe(409);
    }
    expect((await c.get('/me/xp')).body.totalXP).toBe(xp1);
  });
});
