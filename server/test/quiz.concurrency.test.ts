import { beforeAll, describe, expect, it } from 'vitest';
import { AssessmentSession, QuizAttempt, UserProgress } from '../src/models/index.js';
import { buildTestApp, makeCredentials } from './helpers/fixtures.js';
import {
  answersFor,
  completeContent,
  createCurriculum,
  signedInEmployee,
  spyHooks,
  startQuiz,
  syncLearningIndexes,
} from './helpers/learningFixtures.js';

let creds: { password: string; hash: string };

beforeAll(async () => {
  creds = await makeCredentials();
  await syncLearningIndexes();
});

describe('races', () => {
  it('CC1: parallel submissions of one session produce exactly one attempt and one completion', async () => {
    const hooks = spyHooks();
    const t = await buildTestApp({}, { learningHooks: hooks });
    const { modules, keys } = await createCurriculum({ count: 2 });
    const m1 = modules[0];
    if (!m1) throw new Error('fixture');
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    const body = { sessionId: session.sessionId, answers: answersFor(session, keys, 5) };

    const results = await Promise.all(
      Array.from({ length: 5 }, () => emp.post(`/modules/${m1.id}/quiz/attempts`, body)),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    for (const loser of results.filter((r) => r.status === 409)) {
      expect(loser.body.error.code).toBe('SESSION_CLOSED');
    }
    expect(await QuizAttempt.countDocuments({})).toBe(1);
    expect((await UserProgress.findOne({ userId: emp.id }).lean())?.attempts).toBe(1);
    expect(hooks.onAttemptRecorded).toHaveBeenCalledTimes(1);
    expect(hooks.onModuleCompleted).toHaveBeenCalledTimes(1);
  });

  it('CC2: a submission racing an abandon has exactly one winner', async () => {
    const t = await buildTestApp();
    const { modules, keys } = await createCurriculum({ count: 1 });
    const m1 = modules[0];
    if (!m1) throw new Error('fixture');
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);

    const [submit, abandon] = await Promise.all([
      emp.post(`/modules/${m1.id}/quiz/attempts`, {
        sessionId: session.sessionId,
        answers: answersFor(session, keys, 5),
      }),
      emp.post(`/modules/${m1.id}/quiz/sessions/${session.sessionId}/abandon`),
    ]);
    expect([submit.status, abandon.status].sort()).toEqual([201, 409]);
    expect(await QuizAttempt.countDocuments({})).toBe(1);
    const attempt = await QuizAttempt.findOne({}).lean();
    expect(attempt?.endReason).toBe(submit.status === 201 ? 'submitted' : 'abandoned');
    const row = await UserProgress.findOne({ userId: emp.id }).lean();
    expect(row?.attempts).toBe(1);
    expect(row?.quizPassed).toBe(submit.status === 201);
  });

  it('CC3: concurrent starts leave exactly one open session', async () => {
    const t = await buildTestApp();
    const { modules } = await createCurriculum({ count: 1 });
    const m1 = modules[0];
    if (!m1) throw new Error('fixture');
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);

    const results = await Promise.all(
      Array.from({ length: 4 }, () => emp.post(`/modules/${m1.id}/quiz/sessions`)),
    );
    for (const r of results) {
      expect([201, 409]).toContain(r.status);
      if (r.status === 409) expect(r.body.error.code).toBe('CONFLICT');
    }
    expect(results.some((r) => r.status === 201)).toBe(true);
    expect(await AssessmentSession.countDocuments({ status: 'open' })).toBe(1);
    // Every other session was closed by an abandon that left an attempt.
    const closed = await AssessmentSession.countDocuments({ status: 'abandoned' });
    expect(await QuizAttempt.countDocuments({ endReason: 'abandoned' })).toBe(closed);
  });
});
