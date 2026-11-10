import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { exerciseFeedbackSchema, moduleProgressSchema } from '@csense/shared';
import { UserProgress } from '../src/models/index.js';
import { buildTestApp, makeCredentials, type TestApp } from './helpers/fixtures.js';
import { createCurriculum, signedInEmployee } from './helpers/learningFixtures.js';

let t: TestApp;
let creds: { password: string; hash: string };

beforeAll(async () => {
  t = await buildTestApp();
  creds = await makeCredentials();
  await UserProgress.syncIndexes();
});

const answerPath = (moduleId: string, exerciseId: string): string =>
  `/modules/${moduleId}/exercises/${exerciseId}/answers`;

describe('exercise answers', () => {
  it('EX1: feedback carries the key and explanation; only the first answer is recorded', async () => {
    const { modules } = await createCurriculum({ count: 1, interactive: [1] });
    const m = modules[0];
    if (!m) throw new Error('fixture');
    const emp = await signedInEmployee(t.app, creds);
    const [ex0 = ''] = m.exerciseIds;

    // Exercise 0's key is index 0 ("Yes").
    const wrong = await emp.post(answerPath(m.id, ex0), { selectedIndex: 1 });
    expect(wrong.status).toBe(200);
    expect(exerciseFeedbackSchema.parse(wrong.body)).toEqual({
      exerciseId: ex0,
      selectedIndex: 1,
      correct: false,
      correctIndex: 0,
      explanation: 'Exercise explanation 1.0',
      recorded: true,
    });

    const again = exerciseFeedbackSchema.parse(
      (await emp.post(answerPath(m.id, ex0), { selectedIndex: 0 })).body,
    );
    expect(again).toMatchObject({ correct: true, recorded: false });

    const row = await UserProgress.findOne({ userId: emp.id }).lean();
    expect(row?.status).toBe('in_progress');
    expect(row?.exerciseAnswers).toHaveLength(1);
    expect(row?.exerciseAnswers[0]).toMatchObject({ selectedIndex: 1, correct: false });
  });

  it('EX2: out-of-range index is 400, unknown exercise 404, locked module 403', async () => {
    const { modules } = await createCurriculum({ count: 2, interactive: [1, 2] });
    const [m1, m2] = modules;
    if (!m1 || !m2) throw new Error('fixture');
    const emp = await signedInEmployee(t.app, creds);

    const far = await emp.post(answerPath(m1.id, m1.exerciseIds[0] ?? ''), { selectedIndex: 2 });
    expect(far.status).toBe(400);
    expect(far.body.error.details.issues[0]).toMatchObject({
      location: 'body',
      path: 'selectedIndex',
    });
    expect(JSON.stringify(far.body)).not.toMatch(/explanation/i);
    expect(
      (await emp.post(answerPath(m1.id, new Types.ObjectId().toHexString()), { selectedIndex: 0 }))
        .status,
    ).toBe(404);
    // An exercise of another module is not found under this one.
    expect(
      (await emp.post(answerPath(m1.id, m2.exerciseIds[0] ?? ''), { selectedIndex: 0 })).status,
    ).toBe(404);

    const locked = await emp.post(answerPath(m2.id, m2.exerciseIds[0] ?? ''), { selectedIndex: 0 });
    expect(locked.status).toBe(403);
    expect(locked.body.error.code).toBe('MODULE_LOCKED');
    expect(JSON.stringify(locked.body)).not.toMatch(/explanation|correctIndex/i);
    expect(await UserProgress.countDocuments({})).toBe(0);
  });

  it('EX2b: rejects extra fields, negatives, floats and strings', async () => {
    const { modules } = await createCurriculum({ count: 1, interactive: [1] });
    const m = modules[0];
    if (!m) throw new Error('fixture');
    const emp = await signedInEmployee(t.app, creds);
    const path = answerPath(m.id, m.exerciseIds[0] ?? '');
    for (const body of [
      { selectedIndex: 0, correct: true },
      { selectedIndex: -1 },
      { selectedIndex: 0.5 },
      { selectedIndex: '0' },
      {},
    ]) {
      expect((await emp.post(path, body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('EX3: content complete is 409 until every exercise is answered, then 200 and idempotent', async () => {
    const { modules } = await createCurriculum({ count: 1, interactive: [1] });
    const m = modules[0];
    if (!m) throw new Error('fixture');
    const emp = await signedInEmployee(t.app, creds);

    const early = await emp.post(`/modules/${m.id}/content/complete`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('CONTENT_INCOMPLETE');

    await emp.post(answerPath(m.id, m.exerciseIds[0] ?? ''), { selectedIndex: 0 });
    expect((await emp.post(`/modules/${m.id}/content/complete`)).status).toBe(409);

    await emp.post(answerPath(m.id, m.exerciseIds[1] ?? ''), { selectedIndex: 0 });
    const done = await emp.post(`/modules/${m.id}/content/complete`);
    expect(done.status).toBe(200);
    const first = moduleProgressSchema.parse(done.body);
    expect(first.contentCompletedAt).toEqual(expect.any(String));

    const repeat = moduleProgressSchema.parse(
      (await emp.post(`/modules/${m.id}/content/complete`)).body,
    );
    expect(repeat.contentCompletedAt).toBe(first.contentCompletedAt);
  });

  it('EX3b: a video module with no exercises completes straight away', async () => {
    const { modules } = await createCurriculum({ count: 1 });
    const emp = await signedInEmployee(t.app, creds);
    const res = await emp.post(`/modules/${modules[0]?.id ?? ''}/content/complete`);
    expect(res.status).toBe(200);
    expect(res.body.contentCompletedAt).toEqual(expect.any(String));
  });

  it('EX3c: concurrent first answers record exactly one', async () => {
    const { modules } = await createCurriculum({ count: 1, interactive: [1] });
    const m = modules[0];
    if (!m) throw new Error('fixture');
    const emp = await signedInEmployee(t.app, creds);
    const path = answerPath(m.id, m.exerciseIds[0] ?? '');
    const results = await Promise.all([
      emp.post(path, { selectedIndex: 0 }),
      emp.post(path, { selectedIndex: 1 }),
      emp.post(path, { selectedIndex: 0 }),
    ]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.recorded === true)).toHaveLength(1);
    const row = await UserProgress.findOne({ userId: emp.id }).lean();
    expect(row?.exerciseAnswers).toHaveLength(1);
  });
});
