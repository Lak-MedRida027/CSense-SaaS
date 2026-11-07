import { beforeAll, describe, expect, it } from 'vitest';
import {
  assessmentSessionSchema,
  attemptResultSchema,
  finalTestOverviewSchema,
  learningOverviewSchema,
} from '@csense/shared';
import { AssessmentSession, FinalTest, QuizAttempt } from '../src/models/index.js';
import { buildTestApp, makeCredentials } from './helpers/fixtures.js';
import {
  answersFor,
  createCurriculum,
  createFinalTest,
  passModule,
  scanForKeys,
  signedInEmployee,
  spyHooks,
  syncLearningIndexes,
  type Client,
  type TestCurriculum,
} from './helpers/learningFixtures.js';

let creds: { password: string; hash: string };

beforeAll(async () => {
  creds = await makeCredentials();
  await syncLearningIndexes();
});

async function passAll(emp: Client, c: TestCurriculum): Promise<void> {
  for (const m of c.modules) await passModule(emp, m, c.keys);
}

describe('final assessment', () => {
  it('FT1: GET /final-test answers while locked, with no questions', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 2 });
    await createFinalTest(c.keys, 15);
    const emp = await signedInEmployee(t.app, creds);

    const res = await emp.get('/final-test');
    expect(res.status).toBe(200);
    expect(finalTestOverviewSchema.parse(res.body)).toMatchObject({
      status: 'locked',
      remainingModules: 2,
      questionCount: 15,
      passingScore: 70,
      canStart: false,
      blockedReason: 'module_locked',
      nextAttemptNumber: 1,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/Final question/);
    expect(scanForKeys(res.body)).toEqual([]);
  });

  it('FT2: starting or submitting is 403 FINAL_TEST_LOCKED until every module is passed', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 2 });
    await createFinalTest(c.keys, 15);
    const emp = await signedInEmployee(t.app, creds);

    const start = await emp.post('/final-test/sessions');
    expect(start.status).toBe(403);
    expect(start.body.error.code).toBe('FINAL_TEST_LOCKED');
    const submit = await emp.post('/final-test/attempts', {
      sessionId: '0'.repeat(24),
      answers: [],
    });
    expect(submit.status).toBe(403);
    expect(submit.body.error.code).toBe('FINAL_TEST_LOCKED');

    const [m1, m2] = c.modules;
    if (!m1 || !m2) throw new Error('fixture');
    await passModule(emp, m1, c.keys);
    expect((await emp.post('/final-test/sessions')).status).toBe(403);
    await passModule(emp, m2, c.keys);
    expect((await emp.post('/final-test/sessions')).status).toBe(201);
    expect(await QuizAttempt.countDocuments({ type: 'FinalTest' })).toBe(0);
  });

  it('FT3: 15 questions, fail then pass, the completion hook fires once, then it is closed', async () => {
    const hooks = spyHooks();
    const t = await buildTestApp({}, { learningHooks: hooks });
    const c = await createCurriculum({ count: 2 });
    const final = await createFinalTest(c.keys, 15);
    const emp = await signedInEmployee(t.app, creds);
    await passAll(emp, c);

    const overview = learningOverviewSchema.parse((await emp.get('/modules')).body);
    expect(overview.finalTest).toMatchObject({ status: 'unlocked', remainingModules: 0 });

    const startRes = await emp.post('/final-test/sessions');
    expect(startRes.status).toBe(201);
    const s1 = assessmentSessionSchema.parse(startRes.body);
    expect(s1.questions).toHaveLength(15);
    expect(s1).toMatchObject({ kind: 'FinalTest', moduleId: null, assessmentId: final.id });
    expect(scanForKeys(startRes.body)).toEqual([]);

    const failed = await emp.post('/final-test/attempts', {
      sessionId: s1.sessionId,
      answers: answersFor(s1, c.keys, 10),
    });
    expect(failed.status).toBe(201);
    expect(attemptResultSchema.parse(failed.body)).toMatchObject({
      kind: 'FinalTest',
      moduleId: null,
      score: 66,
      passed: false,
      attemptNumber: 1,
      progression: { moduleCompleted: false, nextModuleId: null, finalTestUnlocked: true },
    });
    expect(scanForKeys(failed.body).filter((p) => !p.endsWith('.explanation'))).toEqual([]);
    expect(hooks.onFinalTestPassed).not.toHaveBeenCalled();

    const mid = finalTestOverviewSchema.parse((await emp.get('/final-test')).body);
    expect(mid).toMatchObject({ status: 'in_progress', attempts: 1, bestScore: 66, passed: false });

    const s2 = assessmentSessionSchema.parse((await emp.post('/final-test/sessions')).body);
    expect(s2.attemptNumber).toBe(2);
    const passed = await emp.post('/final-test/attempts', {
      sessionId: s2.sessionId,
      answers: answersFor(s2, c.keys, 11),
    });
    expect(passed.body).toMatchObject({ score: 73, passed: true, attemptNumber: 2 });
    expect(hooks.onFinalTestPassed).toHaveBeenCalledTimes(1);
    expect(hooks.onFinalTestPassed).toHaveBeenCalledWith(
      expect.objectContaining({ userId: emp.id, assessmentId: final.id, score: 73 }),
    );

    const done = finalTestOverviewSchema.parse((await emp.get('/final-test')).body);
    expect(done).toMatchObject({
      status: 'completed',
      passed: true,
      bestScore: 73,
      canStart: false,
    });
    expect(done.blockedReason).toBe('already_passed');
    const again = await emp.post('/final-test/sessions');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_PASSED');
    expect(hooks.onFinalTestPassed).toHaveBeenCalledTimes(1);
  });

  it('FT3b: abandoning the final test counts as an attempt', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 1 });
    await createFinalTest(c.keys, 15);
    const emp = await signedInEmployee(t.app, creds);
    await passAll(emp, c);
    const s = assessmentSessionSchema.parse((await emp.post('/final-test/sessions')).body);
    const res = await emp.post(`/final-test/sessions/${s.sessionId}/abandon`);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      endReason: 'abandoned',
      score: 0,
      kind: 'FinalTest',
      review: [],
    });
    expect((await emp.post(`/final-test/sessions/${s.sessionId}/abandon`)).status).toBe(409);
    expect(finalTestOverviewSchema.parse((await emp.get('/final-test')).body).attempts).toBe(1);
  });

  it('FT4: a final-test session cannot be used on a module route, nor the reverse', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 2 });
    await createFinalTest(c.keys, 15);
    const emp = await signedInEmployee(t.app, creds);
    await passAll(emp, c);
    const [m1] = c.modules;
    if (!m1) throw new Error('fixture');

    const s = assessmentSessionSchema.parse((await emp.post('/final-test/sessions')).body);
    const wrong = await emp.post(`/modules/${m1.id}/quiz/attempts`, {
      sessionId: s.sessionId,
      answers: answersFor(s, c.keys, 15),
    });
    expect(wrong.status).toBe(404);
    expect((await emp.post(`/modules/${m1.id}/quiz/sessions/${s.sessionId}/abandon`)).status).toBe(
      404,
    );
    expect((await AssessmentSession.findById(s.sessionId).lean())?.status).toBe('open');

    // Reverse: a quiz session (planted, as the quiz is already passed) on the final route.
    const planted = await AssessmentSession.create({
      userId: emp.id,
      kind: 'Quiz',
      assessmentId: m1.quizId,
      moduleId: m1.id,
      passingScore: 70,
      expiresAt: new Date(Date.now() + 3600_000),
      questions: m1.questionIds.map((q) => ({
        questionId: q,
        optionCount: 4,
        correctAnswer: c.keys.get(q) ?? 0,
      })),
    });
    const reverse = await emp.post('/final-test/attempts', {
      sessionId: planted.id,
      answers: m1.questionIds.map((q) => ({ questionId: q, selectedIndex: c.keys.get(q) ?? 0 })),
    });
    expect(reverse.status).toBe(404);
  });

  it('FT5: with no FinalTest document every final-test route is 404', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 1 });
    const emp = await signedInEmployee(t.app, creds);
    await passAll(emp, c);
    expect(await FinalTest.countDocuments({})).toBe(0);
    expect((await emp.get('/final-test')).status).toBe(404);
    expect((await emp.post('/final-test/sessions')).status).toBe(404);
    expect(
      (await emp.post('/final-test/attempts', { sessionId: '0'.repeat(24), answers: [] })).status,
    ).toBe(404);
    const overview = learningOverviewSchema.parse((await emp.get('/modules')).body);
    expect(overview.finalTest).toBeNull();
  });

  it('FT6: an empty curriculum never unlocks the final test', async () => {
    const t = await buildTestApp();
    await createFinalTest(new Map(), 15);
    const emp = await signedInEmployee(t.app, creds);
    const res = await emp.get('/final-test');
    expect(finalTestOverviewSchema.parse(res.body)).toMatchObject({
      status: 'locked',
      remainingModules: 0,
      canStart: false,
    });
    const start = await emp.post('/final-test/sessions');
    expect(start.status).toBe(403);
    expect(start.body.error.code).toBe('FINAL_TEST_LOCKED');
  });

  it('FT7: the final test needs no content gate and uses its own threshold', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 1 });
    await createFinalTest(c.keys, 10, 90);
    const emp = await signedInEmployee(t.app, creds);
    await passAll(emp, c);
    const s = assessmentSessionSchema.parse((await emp.post('/final-test/sessions')).body);
    expect(s.passingScore).toBe(90);
    const res = await emp.post('/final-test/attempts', {
      sessionId: s.sessionId,
      answers: answersFor(s, c.keys, 8),
    });
    expect(res.body).toMatchObject({ score: 80, passed: false, passingScore: 90 });
  });
});
