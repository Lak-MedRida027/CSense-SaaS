import { beforeAll, describe, expect, it } from 'vitest';
import {
  assessmentSessionSchema,
  attemptResultSchema,
  quizOverviewSchema,
  type AssessmentSessionDTO,
} from '@csense/shared';
import { AssessmentSession, Quiz, QuizAttempt, UserProgress } from '../src/models/index.js';
import { buildTestApp, makeCredentials, type TestApp } from './helpers/fixtures.js';
import {
  answersFor,
  completeContent,
  createCurriculum,
  loadKeys,
  passModule,
  scanForKeys,
  signedInEmployee,
  startQuiz,
  syncLearningIndexes,
} from './helpers/learningFixtures.js';

let t: TestApp;
let creds: { password: string; hash: string };

beforeAll(async () => {
  creds = await makeCredentials();
  await syncLearningIndexes();
});

const reverse = <T>(items: readonly T[]): T[] => [...items].reverse();

describe('quiz sessions', () => {
  it('QS1: the overview has no questions; a session serves them without keys, in shuffled order', async () => {
    t = await buildTestApp({}, { shuffle: reverse });
    const { modules } = await createCurriculum({ count: 2 });
    const m = modules[0];
    if (!m) throw new Error('fixture');
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m);

    const overview = await emp.get(`/modules/${m.id}/quiz`);
    expect(overview.status).toBe(200);
    expect(quizOverviewSchema.parse(overview.body)).toMatchObject({
      questionCount: 5,
      passingScore: 70,
      attempts: 0,
      nextAttemptNumber: 1,
      canStart: true,
      blockedReason: null,
    });
    expect(JSON.stringify(overview.body)).not.toMatch(/Question 1\.|Option A/);
    expect(scanForKeys(overview.body)).toEqual([]);

    const { res, session } = await startQuiz(emp, m.id);
    expect(res.status).toBe(201);
    assessmentSessionSchema.parse(res.body);
    expect(scanForKeys(res.body)).toEqual([]);
    expect(JSON.stringify(res.body)).not.toMatch(/Why 1\./);
    // The injected shuffle reversed the authored order; options keep their authored order.
    const authored = (await Quiz.findById(m.quizId).lean())?.questions.map((q) =>
      q.questionId.toHexString(),
    );
    expect(session.questions.map((q) => q.questionId)).toEqual(reverse(authored ?? []));
    expect(session.questions[0]?.options).toEqual(['Option A', 'Option B', 'Option C', 'Option D']);
    expect(session).toMatchObject({
      kind: 'Quiz',
      moduleId: m.id,
      assessmentId: m.quizId,
      passingScore: 70,
      attemptNumber: 1,
    });
    // expiresAt = startedAt + the configured TTL (3600 s in tests).
    expect(Date.parse(session.expiresAt) - Date.parse(session.startedAt)).toBe(3600_000);
  });

  it('QS1b: the default shuffle is a permutation of the quiz', async () => {
    const real = await buildTestApp();
    const { modules } = await createCurriculum({ count: 1, questions: 8 });
    const m = modules[0];
    if (!m) throw new Error('fixture');
    const emp = await signedInEmployee(real.app, creds);
    await completeContent(emp, m);
    const { session } = await startQuiz(emp, m.id);
    expect([...session.questions.map((q) => q.questionId)].sort()).toEqual(
      [...m.questionIds].sort(),
    );
  });

  it('QS1c: the session stores a key snapshot that is never serialised', async () => {
    t = await buildTestApp();
    const { modules } = await createCurriculum({ count: 1 });
    const m = modules[0];
    if (!m) throw new Error('fixture');
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m);
    const { session } = await startQuiz(emp, m.id);

    const plain = await AssessmentSession.findById(session.sessionId).lean();
    expect(plain?.questions[0]).not.toHaveProperty('correctAnswer');
    const withKeys = await AssessmentSession.findById(session.sessionId)
      .select('+questions.correctAnswer')
      .lean();
    expect(withKeys?.questions.every((q) => Number.isInteger(q.correctAnswer))).toBe(true);
    const doc = await AssessmentSession.findById(session.sessionId);
    expect(JSON.stringify(doc?.toJSON())).not.toContain('questions');
  });

  it('QS2: content incomplete is 409, a locked module 403, a passed quiz 409 ALREADY_PASSED', async () => {
    t = await buildTestApp();
    const { modules, keys } = await createCurriculum({ count: 2, interactive: [1] });
    const [m1, m2] = modules;
    if (!m1 || !m2) throw new Error('fixture');
    const emp = await signedInEmployee(t.app, creds);

    const early = await startQuiz(emp, m1.id);
    expect(early.res.status).toBe(409);
    expect(early.res.body.error.code).toBe('CONTENT_INCOMPLETE');
    expect(await AssessmentSession.countDocuments({})).toBe(0);

    const locked = await startQuiz(emp, m2.id);
    expect(locked.res.status).toBe(403);
    expect(locked.res.body.error.code).toBe('MODULE_LOCKED');

    await passModule(emp, m1, keys);
    const again = await startQuiz(emp, m1.id);
    expect(again.res.status).toBe(409);
    expect(again.res.body.error.code).toBe('ALREADY_PASSED');
  });

  it('QS3: starting while a session is open abandons the old one and counts an attempt (D5)', async () => {
    t = await buildTestApp();
    const { modules } = await createCurriculum({ count: 1 });
    const m = modules[0];
    if (!m) throw new Error('fixture');
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m);

    const first = (await startQuiz(emp, m.id)).session;
    const second = (await startQuiz(emp, m.id)).session;
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.attemptNumber).toBe(2);

    const old = await AssessmentSession.findById(first.sessionId).lean();
    expect(old?.status).toBe('abandoned');
    expect(await AssessmentSession.countDocuments({ status: 'open' })).toBe(1);

    const attempts = await QuizAttempt.find({ userId: emp.id }).lean();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      endReason: 'abandoned',
      score: 0,
      passed: false,
      attemptNumber: 1,
      totalCount: 5,
      correctCount: 0,
    });
    expect(attempts[0]?.answers).toHaveLength(5);
    expect(attempts[0]?.answers.every((a) => a.selectedIndex === null && !a.correct)).toBe(true);
    const row = await UserProgress.findOne({ userId: emp.id }).lean();
    expect(row?.attempts).toBe(1);
    expect(row?.quizScore).toBeUndefined();
    expect(row?.quizPassed).toBe(false);

    // The abandoned session can no longer be submitted.
    const stale = await emp.post(`/modules/${m.id}/quiz/attempts`, {
      sessionId: first.sessionId,
      answers: [],
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('SESSION_CLOSED');
  });

  it('QS4: explicit abandon is a 201 with score 0 and no review; a second abandon is 409', async () => {
    t = await buildTestApp();
    const { modules } = await createCurriculum({ count: 2 });
    const m = modules[0];
    if (!m) throw new Error('fixture');
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m);
    const { session } = await startQuiz(emp, m.id);

    const res = await emp.post(`/modules/${m.id}/quiz/sessions/${session.sessionId}/abandon`);
    expect(res.status).toBe(201);
    const body = attemptResultSchema.parse(res.body);
    expect(body).toMatchObject({
      endReason: 'abandoned',
      score: 0,
      passed: false,
      review: [],
      progression: { moduleCompleted: false, nextModuleId: null, finalTestUnlocked: false },
    });
    expect(scanForKeys(res.body)).toEqual([]);

    const again = await emp.post(`/modules/${m.id}/quiz/sessions/${session.sessionId}/abandon`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SESSION_CLOSED');
    expect(await QuizAttempt.countDocuments({})).toBe(1);
    expect((await UserProgress.findOne({ userId: emp.id }).lean())?.attempts).toBe(1);
  });

  it('QS5: attemptNumber increments across submit, abandon and expiry', async () => {
    t = await buildTestApp({ learning: { sessionTtlSeconds: 300 } });
    const { modules, keys } = await createCurriculum({ count: 1, passingScore: 100 });
    const m = modules[0];
    if (!m) throw new Error('fixture');
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m);

    // 1: submitted (fails at threshold 100)
    const s1 = (await startQuiz(emp, m.id)).session;
    const r1 = await emp.post(`/modules/${m.id}/quiz/attempts`, {
      sessionId: s1.sessionId,
      answers: answersFor(s1, keys, 3),
    });
    expect(r1.body).toMatchObject({ attemptNumber: 1, endReason: 'submitted', passed: false });

    // 2: abandoned
    const s2 = (await startQuiz(emp, m.id)).session;
    expect(s2.attemptNumber).toBe(2);
    const r2 = await emp.post(`/modules/${m.id}/quiz/sessions/${s2.sessionId}/abandon`);
    expect(r2.body).toMatchObject({ attemptNumber: 2, endReason: 'abandoned' });

    // 3: expired (starting anew after the limit closes the stale session as expired)
    const s3 = (await startQuiz(emp, m.id)).session;
    t.advance(301_000);
    const s4 = (await startQuiz(emp, m.id)).session;
    expect(s4.attemptNumber).toBe(4);
    const attempts = await QuizAttempt.find({ userId: emp.id }).sort({ attemptNumber: 1 }).lean();
    expect(attempts.map((a) => [a.attemptNumber, a.endReason])).toEqual([
      [1, 'submitted'],
      [2, 'abandoned'],
      [3, 'expired'],
    ]);
    expect((await AssessmentSession.findById(s3.sessionId).lean())?.status).toBe('expired');
    expect((await UserProgress.findOne({ userId: emp.id }).lean())?.attempts).toBe(3);
  });

  it('QS6: a quiz session snapshot ignores later edits to the live quiz', async () => {
    t = await buildTestApp();
    const { modules } = await createCurriculum({ count: 1 });
    const m = modules[0];
    if (!m) throw new Error('fixture');
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m);
    const { session } = await startQuiz(emp, m.id);
    const served: AssessmentSessionDTO = session;
    const keys = await loadKeys(m.quizId);

    // The quiz is edited in place after the session started: every key moves by one.
    const doc = await Quiz.findById(m.quizId).select('+questions.correctAnswer');
    doc?.questions.forEach((q) => {
      q.correctAnswer = (q.correctAnswer + 1) % 4;
    });
    await doc?.save();

    const res = await emp.post(`/modules/${m.id}/quiz/attempts`, {
      sessionId: served.sessionId,
      answers: answersFor(served, keys, 5),
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ passed: true, score: 100 });
  });
});
