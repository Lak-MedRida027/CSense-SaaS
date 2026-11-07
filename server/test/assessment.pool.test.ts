import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { attemptDetailSchema, quizOverviewSchema, type AssessmentSessionDTO } from '@csense/shared';
import { Quiz } from '../src/models/index.js';
import { buildTestApp, makeCredentials } from './helpers/fixtures.js';
import {
  answersFor,
  completeContent,
  createCurriculum,
  createFinalTest,
  loadKeys,
  signedInEmployee,
  startQuiz,
  submitQuiz,
} from './helpers/learningFixtures.js';

let creds: { password: string; hash: string };

beforeAll(async () => {
  creds = await makeCredentials();
});

const need = <T>(v: T | undefined): T => {
  if (v === undefined) throw new Error('fixture');
  return v;
};

const identity = <T>(items: readonly T[]): T[] => [...items];
const reverse = <T>(items: readonly T[]): T[] => [...items].reverse();
const ids = (s: AssessmentSessionDTO): string[] => s.questions.map((q) => q.questionId);

describe('question pool (P3-M1)', () => {
  it('POOL1: a session serves questionsPerSession questions drawn from a larger pool', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 1, questions: 10, questionsPerSession: 5 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);

    const overview = quizOverviewSchema.parse((await emp.get(`/modules/${m1.id}/quiz`)).body);
    expect(overview.questionCount).toBe(5); // what a session serves, not the pool
    expect(JSON.stringify(overview)).not.toMatch(/pool/i);

    const { session } = await startQuiz(emp, m1.id);
    expect(session.questions).toHaveLength(5);
    expect(new Set(ids(session)).size).toBe(5);
    expect(ids(session).every((id) => m1.questionIds.includes(id))).toBe(true);
  });

  it('POOL2: unseen questions come first, then the least recently served, deterministically', async () => {
    const t = await buildTestApp({}, { shuffle: identity });
    const c = await createCurriculum({
      count: 1,
      questions: 10,
      questionsPerSession: 5,
      passingScore: 100,
    });
    const m1 = need(c.modules[0]);
    const pool = m1.questionIds; // authored order
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);

    const serve = async (): Promise<string[]> => {
      const { session } = await startQuiz(emp, m1.id);
      expect(session.questions).toHaveLength(5);
      await submitQuiz(emp, m1.id, session, c.keys, 0); // a failed attempt records what was served
      return ids(session);
    };
    const first = await serve();
    const second = await serve();
    const third = await serve();
    const fourth = await serve();
    expect(first).toEqual(pool.slice(0, 5));
    expect(second).toEqual(pool.slice(5, 10)); // everything unseen is used before any repeat
    expect(third).toEqual(pool.slice(0, 5)); // none unseen: the attempt served longest ago
    expect(fourth).toEqual(pool.slice(5, 10)); // then the next oldest
  });

  it('POOL3: a partly seen pool tops up unseen first and only then repeats', async () => {
    const t = await buildTestApp({}, { shuffle: identity });
    const c = await createCurriculum({
      count: 1,
      questions: 8,
      questionsPerSession: 5,
      passingScore: 100,
    });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const a = (await startQuiz(emp, m1.id)).session;
    await submitQuiz(emp, m1.id, a, c.keys, 0);
    const b = (await startQuiz(emp, m1.id)).session;
    // 3 unseen (q5-q7) are all used, the other 2 come from the one earlier attempt.
    expect(ids(b).filter((id) => !ids(a).includes(id))).toEqual(m1.questionIds.slice(5, 8));
    expect(ids(b).filter((id) => ids(a).includes(id))).toHaveLength(2);
  });

  it('POOL4: the injected shuffle makes selection and order reproducible', async () => {
    const t = await buildTestApp({}, { shuffle: reverse });
    const c = await createCurriculum({ count: 1, questions: 10, questionsPerSession: 5 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    // The reversed pool yields q9..q5 for the tier; the final presentation shuffle reverses it back.
    expect(ids(session)).toEqual(m1.questionIds.slice(5, 10));
  });

  it('POOL5: grading, totals and validation cover only the served questions', async () => {
    const t = await buildTestApp({}, { shuffle: identity });
    const c = await createCurriculum({ count: 1, questions: 10, questionsPerSession: 5 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    const unserved = need(m1.questionIds[9]);
    expect(ids(session)).not.toContain(unserved);

    // A pool question that was not served is rejected like any other foreign id.
    const bad = await emp.post(`/modules/${m1.id}/quiz/attempts`, {
      sessionId: session.sessionId,
      answers: [{ questionId: unserved, selectedIndex: 0 }],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.issues[0].path).toBe('answers.0.questionId');

    // 4 of the 5 served questions right is 80 percent, whatever the size of the pool.
    const ok = await submitQuiz(emp, m1.id, session, c.keys, 4);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ score: 80, correctCount: 4, totalCount: 5, passed: true });
    expect(ok.body.review).toHaveLength(5);
  });

  it('POOL6: after a pass only the questions the employee was served have their key revealed', async () => {
    const t = await buildTestApp({}, { shuffle: identity });
    const c = await createCurriculum({
      count: 1,
      questions: 15,
      questionsPerSession: 5,
      passingScore: 100,
    });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);

    const failed = (await startQuiz(emp, m1.id)).session;
    const failedRes = await submitQuiz(emp, m1.id, failed, c.keys, 2);
    const passSession = (await startQuiz(emp, m1.id)).session;
    const passRes = await submitQuiz(emp, m1.id, passSession, c.keys, 5);
    expect(passRes.body.passed).toBe(true);

    const servedIds = new Set([...ids(failed), ...ids(passSession)]);
    expect(servedIds.size).toBe(10);
    const unservedIds = m1.questionIds.filter((id) => !servedIds.has(id));
    expect(unservedIds).toHaveLength(5);

    const detail = attemptDetailSchema.parse(
      (await emp.get(`/me/attempts/${failedRes.body.attemptId}`)).body,
    );
    // The earlier failed attempt now shows its own correct options, and nothing else.
    expect(detail.review.map((r) => r.questionId)).toEqual(ids(failed));
    expect(detail.review.every((r) => typeof r.correctIndex === 'number')).toBe(true);

    const everything = JSON.stringify([failedRes.body, passRes.body, detail]);
    for (const id of unservedIds) expect(everything).not.toContain(id);
    // The unserved keys stay on the server: the list endpoint carries no review at all.
    const list = JSON.stringify((await emp.get('/me/attempts')).body);
    for (const id of unservedIds) expect(list).not.toContain(id);
  });

  it('POOL7: the model refuses to serve more questions than the pool holds', async () => {
    await expect(
      Quiz.create({
        title: 'Too many',
        moduleId: new Types.ObjectId(),
        questionsPerSession: 9,
        questions: Array.from({ length: 3 }, (_, i) => ({
          text: `Q${String(i)}`,
          options: ['a', 'b'],
          correctAnswer: 0,
        })),
      }),
    ).rejects.toThrow(/cannot exceed/);
  });

  it('POOL8: the final test serves 15 of a pool of 30 and covers unseen questions on a retry', async () => {
    const t = await buildTestApp({}, { shuffle: identity });
    const c = await createCurriculum({ count: 1 });
    const final = await createFinalTest(c.keys, 30, 70, 15);
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const s0 = (await startQuiz(emp, m1.id)).session;
    await submitQuiz(emp, m1.id, s0, c.keys, 5);

    const a = (await emp.post('/final-test/sessions')).body as AssessmentSessionDTO;
    expect(a.questions).toHaveLength(15);
    await emp.post('/final-test/attempts', {
      sessionId: a.sessionId,
      answers: answersFor(a, c.keys, 0),
    });
    const b = (await emp.post('/final-test/sessions')).body as AssessmentSessionDTO;
    expect(b.questions).toHaveLength(15);
    expect(ids(a)).toEqual(final.questionIds.slice(0, 15));
    expect(ids(b)).toEqual(final.questionIds.slice(15, 30));
    expect((await loadKeys(final.id)).size).toBe(30);
  });
});
