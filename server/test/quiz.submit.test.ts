import { beforeAll, describe, expect, it } from 'vitest';
import { attemptDetailSchema, attemptResultSchema, learningOverviewSchema } from '@csense/shared';
import { QuizAttempt, UserProgress } from '../src/models/index.js';
import { buildTestApp, makeCredentials, type TestApp } from './helpers/fixtures.js';
import {
  answersFor,
  completeContent,
  createCurriculum,
  failModule,
  passModule,
  scanForKeys,
  signedInEmployee,
  startQuiz,
  submitQuiz,
  syncLearningIndexes,
  type TestModule,
} from './helpers/learningFixtures.js';

let t: TestApp;
let creds: { password: string; hash: string };

beforeAll(async () => {
  t = await buildTestApp();
  creds = await makeCredentials();
  await syncLearningIndexes();
});

const need = (m: TestModule | undefined): TestModule => {
  if (!m) throw new Error('fixture');
  return m;
};

/** Keys/ids of the review that must never appear before they are earned. */
const leaks = (body: unknown): string[] =>
  scanForKeys(body).filter((p) => !p.endsWith('.explanation'));

describe('quiz submission', () => {
  it('QG1: a passing submission completes the module and unlocks the next one', async () => {
    const { modules, keys } = await createCurriculum({ count: 3 });
    const [m1, m2] = [need(modules[0]), need(modules[1])];
    const emp = await signedInEmployee(t.app, creds);

    const res = await passModule(emp, m1, keys);
    const body = attemptResultSchema.parse(res.body);
    expect(body).toMatchObject({
      kind: 'Quiz',
      moduleId: m1.id,
      assessmentId: m1.quizId,
      attemptNumber: 1,
      endReason: 'submitted',
      score: 100,
      passed: true,
      correctCount: 5,
      totalCount: 5,
      passingScore: 70,
      progression: { moduleCompleted: true, nextModuleId: m2.id, finalTestUnlocked: false },
      effects: {},
    });
    // Passed: the full review, including the correct option.
    expect(body.review).toHaveLength(5);
    expect(body.review.every((r) => r.correct && typeof r.correctIndex === 'number')).toBe(true);

    const row = await UserProgress.findOne({ userId: emp.id, moduleId: m1.id }).lean();
    expect(row).toMatchObject({
      status: 'completed',
      quizPassed: true,
      quizScore: 100,
      attempts: 1,
    });
    expect(row?.completedAt).toBeInstanceOf(Date);

    const overview = learningOverviewSchema.parse((await emp.get('/modules')).body);
    expect(overview.modules.map((m) => m.status)).toEqual(['completed', 'unlocked', 'locked']);
  });

  it('QG2: a failing submission shows correctness and explanations but never the correct option', async () => {
    const { modules, keys } = await createCurriculum({ count: 2 });
    const [m1, m2] = [need(modules[0]), need(modules[1])];
    const emp = await signedInEmployee(t.app, creds);

    const res = await failModule(emp, m1, keys, 2);
    const body = attemptResultSchema.parse(res.body);
    expect(body).toMatchObject({
      score: 40,
      passed: false,
      correctCount: 2,
      progression: { moduleCompleted: false, nextModuleId: null },
    });
    expect(leaks(res.body)).toEqual([]);
    expect(body.review.filter((r) => r.correct)).toHaveLength(2);
    expect(body.review.every((r) => typeof r.explanation === 'string')).toBe(true);
    expect(body.review.every((r) => r.options.length === 4)).toBe(true);

    const overview = learningOverviewSchema.parse((await emp.get('/modules')).body);
    expect(overview.modules.map((m) => m.status)).toEqual(['in_progress', 'locked']);
    expect(overview.modules[0]).toMatchObject({ attempts: 1, bestScore: 40, passed: false });
    expect((await emp.get(`/modules/${m2.id}/quiz`)).status).toBe(403);
  });

  it('QG3: retry after a fail, then pass; the failed attempt then reveals the correct option', async () => {
    const { modules, keys } = await createCurriculum({ count: 2 });
    const m1 = need(modules[0]);
    const emp = await signedInEmployee(t.app, creds);

    const failed = await failModule(emp, m1, keys, 3);
    const failedId = failed.body.attemptId as string;
    expect((await emp.get(`/me/attempts/${failedId}`)).body.review[0]).not.toHaveProperty(
      'correctIndex',
    );

    const { session } = await startQuiz(emp, m1.id);
    expect(session.attemptNumber).toBe(2);
    const passed = await submitQuiz(emp, m1.id, session, keys, 5);
    expect(passed.body).toMatchObject({ passed: true, attemptNumber: 2 });

    const later = await emp.get(`/me/attempts/${failedId}`);
    const detail = attemptDetailSchema.parse(later.body);
    expect(detail.passed).toBe(false);
    expect(detail.review.every((r) => typeof r.correctIndex === 'number')).toBe(true);
    const indexed = new Map(detail.review.map((r) => [r.questionId, r.correctIndex]));
    for (const [q, key] of keys) if (indexed.has(q)) expect(indexed.get(q)).toBe(key);
  });

  it('QG4: quizScore keeps the best score, not the last', async () => {
    const { modules, keys } = await createCurriculum({ count: 1, passingScore: 90 });
    const m1 = need(modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);

    const a = (await startQuiz(emp, m1.id)).session;
    expect((await submitQuiz(emp, m1.id, a, keys, 4)).body.score).toBe(80);
    const b = (await startQuiz(emp, m1.id)).session;
    expect((await submitQuiz(emp, m1.id, b, keys, 2)).body.score).toBe(40);

    const row = await UserProgress.findOne({ userId: emp.id }).lean();
    expect(row).toMatchObject({ quizScore: 80, attempts: 2, quizPassed: false });
  });

  it('QG5: unanswered questions count as wrong and are recorded as null', async () => {
    const { modules, keys } = await createCurriculum({ count: 1 });
    const m1 = need(modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);

    const some = answersFor(session, keys, 5).slice(0, 2);
    const res = await emp.post(`/modules/${m1.id}/quiz/attempts`, {
      sessionId: session.sessionId,
      answers: [...some, { questionId: session.questions[4]?.questionId, selectedIndex: null }],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ score: 40, correctCount: 2, totalCount: 5, passed: false });
    const items = res.body.review as { selectedIndex: number | null; questionId: string }[];
    expect(items.map((r) => r.questionId)).toEqual(session.questions.map((q) => q.questionId));
    expect(items.filter((r) => r.selectedIndex === null)).toHaveLength(3);

    const stored = await QuizAttempt.findOne({ userId: emp.id }).lean();
    expect(stored?.answers.map((a) => a.selectedIndex === null)).toEqual([
      false,
      false,
      true,
      true,
      true,
    ]);
  });

  it('QG5b: an empty submission is a graded zero, not an error', async () => {
    const { modules } = await createCurriculum({ count: 1 });
    const m1 = need(modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    const res = await emp.post(`/modules/${m1.id}/quiz/attempts`, {
      sessionId: session.sessionId,
      answers: [],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ score: 0, passed: false, correctCount: 0 });
  });

  it('QG6: the threshold is per module (60 passes 3/5, 70 does not)', async () => {
    const { modules, keys } = await createCurriculum({ count: 2, passingScore: [60, 70] });
    const [m1, m2] = [need(modules[0]), need(modules[1])];
    const emp = await signedInEmployee(t.app, creds);

    await completeContent(emp, m1);
    const s1 = (await startQuiz(emp, m1.id)).session;
    expect(s1.passingScore).toBe(60);
    const r1 = await submitQuiz(emp, m1.id, s1, keys, 3);
    expect(r1.body).toMatchObject({ score: 60, passed: true, passingScore: 60 });

    await completeContent(emp, m2);
    const s2 = (await startQuiz(emp, m2.id)).session;
    expect(s2.passingScore).toBe(70);
    const r2 = await submitQuiz(emp, m2.id, s2, keys, 3);
    expect(r2.body).toMatchObject({ score: 60, passed: false, passingScore: 70 });
  });

  it('a submission is stored append-only with the served order and a unique session', async () => {
    const { modules, keys } = await createCurriculum({ count: 1 });
    const m1 = need(modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    await submitQuiz(emp, m1.id, session, keys, 5);

    const stored = await QuizAttempt.find({ userId: emp.id }).lean();
    expect(stored).toHaveLength(1);
    expect(String(stored[0]?.sessionId)).toBe(session.sessionId);
    expect(stored[0]?.answers.map((a) => a.questionId.toHexString())).toEqual(
      session.questions.map((q) => q.questionId),
    );
  });
});
