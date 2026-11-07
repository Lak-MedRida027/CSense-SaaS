import { beforeAll, describe, expect, it } from 'vitest';
import { attemptDetailSchema, attemptListSchema } from '@csense/shared';
import { Quiz } from '../src/models/index.js';
import { buildTestApp, makeCredentials, type TestApp } from './helpers/fixtures.js';
import {
  completeContent,
  createCurriculum,
  failModule,
  passModule,
  scanForKeys,
  signedInEmployee,
  startQuiz,
  submitQuiz,
  syncLearningIndexes,
  type Client,
  type TestCurriculum,
} from './helpers/learningFixtures.js';

let t: TestApp;
let creds: { password: string; hash: string };

beforeAll(async () => {
  t = await buildTestApp();
  creds = await makeCredentials();
  await syncLearningIndexes();
});

/** m1: fail, fail, pass. m2: abandon. Returns attempt ids in creation order. */
async function history(emp: Client, c: TestCurriculum): Promise<string[]> {
  const [m1, m2] = c.modules;
  if (!m1 || !m2) throw new Error('fixture');
  const ids: string[] = [];
  ids.push((await failModule(emp, m1, c.keys, 1)).body.attemptId);
  ids.push((await failModule(emp, m1, c.keys, 2)).body.attemptId);
  ids.push((await passModule(emp, m1, c.keys)).body.attemptId);
  await completeContent(emp, m2);
  const { session } = await startQuiz(emp, m2.id);
  ids.push(
    (await emp.post(`/modules/${m2.id}/quiz/sessions/${session.sessionId}/abandon`)).body.attemptId,
  );
  return ids;
}

describe('GET /me/attempts', () => {
  it('MA1: lists only the caller, newest first, with cursor pagination and filters', async () => {
    const c = await createCurriculum({ count: 2 });
    const a = await signedInEmployee(t.app, creds);
    const b = await signedInEmployee(t.app, creds);
    const ids = await history(a, c);
    const [m1] = c.modules;
    if (!m1) throw new Error('fixture');
    await passModule(b, m1, c.keys);

    const all = attemptListSchema.parse((await a.get('/me/attempts')).body);
    expect(all.items.map((i) => i.attemptId)).toEqual([...ids].reverse());
    expect(all.nextCursor).toBeNull();
    expect(all.items.map((i) => i.endReason)).toEqual([
      'abandoned',
      'submitted',
      'submitted',
      'submitted',
    ]);

    const page1 = attemptListSchema.parse((await a.get('/me/attempts?limit=3')).body);
    expect(page1.items).toHaveLength(3);
    expect(page1.nextCursor).toBe(page1.items[2]?.attemptId);
    const page2 = attemptListSchema.parse(
      (await a.get(`/me/attempts?limit=3&before=${page1.nextCursor ?? ''}`)).body,
    );
    expect(page2.items.map((i) => i.attemptId)).toEqual([ids[0]]);
    expect(page2.nextCursor).toBeNull();

    const m2Only = attemptListSchema.parse(
      (await a.get(`/me/attempts?moduleId=${c.modules[1]?.id}`)).body,
    );
    expect(m2Only.items).toHaveLength(1);
    expect(
      attemptListSchema.parse((await a.get('/me/attempts?kind=FinalTest')).body).items,
    ).toEqual([]);
    expect(
      attemptListSchema.parse((await a.get('/me/attempts?kind=Quiz')).body).items,
    ).toHaveLength(4);

    const mine = attemptListSchema.parse((await b.get('/me/attempts')).body);
    expect(mine.items).toHaveLength(1);
    expect(scanForKeys((await a.get('/me/attempts')).body)).toEqual([]);
  });

  it("MA1b: another employee's attempt id is not a valid cursor", async () => {
    const c = await createCurriculum({ count: 1 });
    const a = await signedInEmployee(t.app, creds);
    const b = await signedInEmployee(t.app, creds);
    const [m1] = c.modules;
    if (!m1) throw new Error('fixture');
    const theirs = (await passModule(a, m1, c.keys)).body.attemptId;
    const res = await b.get(`/me/attempts?before=${theirs}`);
    expect(res.status).toBe(400);
  });
});

describe('GET /me/attempts/:attemptId', () => {
  it("MA2: another user's attempt is 404 and indistinguishable from an unknown id", async () => {
    const c = await createCurriculum({ count: 1 });
    const a = await signedInEmployee(t.app, creds);
    const b = await signedInEmployee(t.app, creds);
    const [m1] = c.modules;
    if (!m1) throw new Error('fixture');
    const theirs = (await passModule(a, m1, c.keys)).body.attemptId;

    const stolen = await b.get(`/me/attempts/${theirs}`);
    const unknown = await b.get(`/me/attempts/${'0'.repeat(24)}`);
    expect(stolen.status).toBe(404);
    expect(stolen.body).toEqual(unknown.body);
    expect((await a.get(`/me/attempts/${theirs}`)).status).toBe(200);
  });

  it('MA3: an invalid id, an unknown query parameter and a bad limit are 400', async () => {
    const a = await signedInEmployee(t.app, creds);
    expect((await a.get('/me/attempts/not-an-id')).status).toBe(400);
    expect((await a.get('/me/attempts?userId=abc')).status).toBe(400);
    expect((await a.get('/me/attempts?limit=0')).status).toBe(400);
    expect((await a.get('/me/attempts?limit=101')).status).toBe(400);
    expect((await a.get('/me/attempts?kind=Other')).status).toBe(400);
    expect((await a.get('/me/attempts?before=zzz')).status).toBe(400);
  });

  it('MA4: the detail review follows the reveal policy', async () => {
    const c = await createCurriculum({ count: 2 });
    const a = await signedInEmployee(t.app, creds);
    const [m1] = c.modules;
    if (!m1) throw new Error('fixture');

    // Failed and not yet passed: correctness and explanation, no correct option.
    const failed = (await failModule(a, m1, c.keys, 2)).body.attemptId;
    const f1 = await a.get(`/me/attempts/${failed}`);
    const d1 = attemptDetailSchema.parse(f1.body);
    expect(d1.review).toHaveLength(5);
    expect(
      d1.review.every((r) => r.explanation !== undefined && r.correctIndex === undefined),
    ).toBe(true);
    expect(scanForKeys(f1.body).filter((p) => p.endsWith('.correctIndex'))).toEqual([]);

    // Abandoned: nothing to review.
    const { session } = await startQuiz(a, m1.id);
    const abandoned = (await a.post(`/modules/${m1.id}/quiz/sessions/${session.sessionId}/abandon`))
      .body.attemptId;
    expect(
      attemptDetailSchema.parse((await a.get(`/me/attempts/${abandoned}`)).body).review,
    ).toEqual([]);

    // After passing, the earlier failed attempt shows the correct option.
    const second = await startQuiz(a, m1.id);
    await submitQuiz(a, m1.id, second.session, c.keys, 5);
    const d2 = attemptDetailSchema.parse((await a.get(`/me/attempts/${failed}`)).body);
    expect(d2.review.every((r) => typeof r.correctIndex === 'number')).toBe(true);
  });

  it('MA5: a question removed after the attempt is shown as unavailable, without a key', async () => {
    const c = await createCurriculum({ count: 1 });
    const a = await signedInEmployee(t.app, creds);
    const [m1] = c.modules;
    if (!m1) throw new Error('fixture');
    const attemptId = (await passModule(a, m1, c.keys)).body.attemptId;

    const removed = m1.questionIds[0] ?? '';
    const quiz = await Quiz.findById(m1.quizId);
    quiz?.questions.pull({ questionId: removed });
    await quiz?.save();

    const detail = attemptDetailSchema.parse((await a.get(`/me/attempts/${attemptId}`)).body);
    const gone = detail.review.find((r) => r.questionId === removed);
    expect(gone).toMatchObject({
      text: 'This question is no longer available',
      options: [],
      correct: true,
    });
    expect(gone).not.toHaveProperty('correctIndex');
    expect(gone).not.toHaveProperty('explanation');
    expect(detail.review).toHaveLength(5);
  });
});
