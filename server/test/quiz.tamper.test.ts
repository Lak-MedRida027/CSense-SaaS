import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { AssessmentSession, QuizAttempt, UserProgress } from '../src/models/index.js';
import { buildTestApp, createAdmin, loginOk, makeCredentials } from './helpers/fixtures.js';
import {
  answersFor,
  clientFor,
  completeContent,
  createCurriculum,
  createFinalTest,
  passModule,
  signedInEmployee,
  spyHooks,
  startQuiz,
  submitQuiz,
  syncLearningIndexes,
  type TestModule,
} from './helpers/learningFixtures.js';

let creds: { password: string; hash: string };

beforeAll(async () => {
  creds = await makeCredentials();
  await syncLearningIndexes();
});

const need = (m: TestModule | undefined): TestModule => {
  if (!m) throw new Error('fixture');
  return m;
};

describe('tamper resistance', () => {
  it('TA1: a body claiming a pass is rejected with 400 and records nothing', async () => {
    const t = await buildTestApp();
    const { modules, keys } = await createCurriculum({ count: 2 });
    const m1 = need(modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    const path = `/modules/${m1.id}/quiz/attempts`;
    const valid = answersFor(session, keys, 5);

    for (const forged of [
      { passed: true },
      { score: 100 },
      { passed: true, score: 100, correct: true },
      { userId: emp.id },
      { status: 'completed' },
    ]) {
      for (const answers of [[], valid]) {
        const res = await emp.post(path, { sessionId: session.sessionId, answers, ...forged });
        expect(res.status, JSON.stringify(forged)).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    }
    // A per-answer verdict is rejected too.
    const verdict = valid.map((a) => ({ ...a, correct: true }));
    expect((await emp.post(path, { sessionId: session.sessionId, answers: verdict })).status).toBe(
      400,
    );
    // As is a forged body with a made-up session id.
    expect(
      (
        await emp.post(path, {
          sessionId: new Types.ObjectId().toHexString(),
          answers: [],
          passed: true,
          score: 100,
        })
      ).status,
    ).toBe(400);

    expect(await QuizAttempt.countDocuments({})).toBe(0);
    expect((await AssessmentSession.findById(session.sessionId).lean())?.status).toBe('open');
    expect((await UserProgress.findOne({ userId: emp.id }).lean())?.quizPassed).toBe(false);
    // The honest submission still works afterwards.
    expect((await submitQuiz(emp, m1.id, session, keys, 5)).status).toBe(201);
  });

  it('TA1b: operator objects in ids are rejected before any query', async () => {
    const t = await buildTestApp();
    const { modules } = await createCurriculum({ count: 1 });
    const m1 = need(modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const path = `/modules/${m1.id}/quiz/attempts`;
    for (const sessionId of [{ $ne: null }, { $gt: '' }, '*', 'a'.repeat(24).replace(/a$/, 'z')]) {
      expect((await emp.post(path, { sessionId, answers: [] })).status).toBe(400);
    }
    expect((await emp.get('/me/attempts?moduleId[$ne]=x')).status).toBe(400);
  });

  it('TA2: there is no route to set progress or completion directly', async () => {
    const t = await buildTestApp();
    const { modules } = await createCurriculum({ count: 2 });
    const m1 = need(modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    expect((await emp.patch('/me/progress', { status: 'completed' })).status).toBe(404);
    expect((await emp.put('/me/progress', { status: 'completed' })).status).toBe(404);
    expect((await emp.post(`/modules/${m1.id}/complete`)).status).toBe(404);
    expect((await emp.put(`/modules/${m1.id}/progress`, { quizPassed: true })).status).toBe(404);
    expect((await emp.patch(`/modules/${m1.id}`, { isPublished: false })).status).toBe(404);
    expect((await emp.post(`/modules/${m1.id}/quiz/grade`, { score: 100 })).status).toBe(404);
    expect((await emp.post('/me/attempts', { passed: true })).status).toBe(404);
    expect(await UserProgress.countDocuments({})).toBe(0);
  });

  it('TA3: start and submit for a locked module are 403 and change nothing', async () => {
    const t = await buildTestApp();
    const { modules, keys } = await createCurriculum({ count: 2 });
    const [m1, m2] = [need(modules[0]), need(modules[1])];
    const emp = await signedInEmployee(t.app, creds);

    expect((await startQuiz(emp, m2.id)).res.status).toBe(403);
    // Even with a genuine open session (planted directly), the lock is re-derived on submit.
    const planted = await AssessmentSession.create({
      userId: emp.id,
      kind: 'Quiz',
      assessmentId: m2.quizId,
      moduleId: m2.id,
      passingScore: 70,
      expiresAt: new Date(Date.now() + 3600_000),
      questions: m2.questionIds.map((q) => ({
        questionId: q,
        optionCount: 4,
        correctAnswer: keys.get(q) ?? 0,
      })),
    });
    const answers = m2.questionIds.map((q) => ({ questionId: q, selectedIndex: keys.get(q) }));
    const res = await emp.post(`/modules/${m2.id}/quiz/attempts`, {
      sessionId: planted.id,
      answers,
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MODULE_LOCKED');
    expect(await QuizAttempt.countDocuments({})).toBe(0);
    expect(await UserProgress.countDocuments({})).toBe(0);
    expect((await AssessmentSession.findById(planted.id).lean())?.status).toBe('open');
    expect(m1.id).not.toBe(m2.id);
  });

  it("TA4: a session from module 1 cannot be submitted on module 2's route", async () => {
    const t = await buildTestApp();
    const { modules, keys } = await createCurriculum({ count: 2 });
    const [m1, m2] = [need(modules[0]), need(modules[1])];
    const emp = await signedInEmployee(t.app, creds);
    await passModule(emp, m1, keys);
    await completeContent(emp, m2);

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
        correctAnswer: keys.get(q) ?? 0,
      })),
    });
    const res = await emp.post(`/modules/${m2.id}/quiz/attempts`, {
      sessionId: planted.id,
      answers: m1.questionIds.map((q) => ({ questionId: q, selectedIndex: keys.get(q) })),
    });
    expect(res.status).toBe(404);
    expect((await emp.post(`/modules/${m2.id}/quiz/sessions/${planted.id}/abandon`)).status).toBe(
      404,
    );
    expect((await AssessmentSession.findById(planted.id).lean())?.status).toBe('open');
  });

  it('TA5: answers for unserved questions are 400 with a path, and the session stays open', async () => {
    const t = await buildTestApp();
    const { modules, keys } = await createCurriculum({ count: 2 });
    const final = await createFinalTest(keys, 3);
    const [m1, m2] = [need(modules[0]), need(modules[1])];
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    const path = `/modules/${m1.id}/quiz/attempts`;
    const good = answersFor(session, keys, 5);

    const attempts: Record<string, unknown[]> = {
      'another quiz': [{ questionId: m2.questionIds[0], selectedIndex: 0 }, ...good.slice(1)],
      'the final test': [{ questionId: final.questionIds[0], selectedIndex: 0 }],
      'made up': [{ questionId: new Types.ObjectId().toHexString(), selectedIndex: 0 }],
    };
    for (const [name, answers] of Object.entries(attempts)) {
      const res = await emp.post(path, { sessionId: session.sessionId, answers });
      expect(res.status, name).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      const issue = (res.body.error.details.issues as { path: string }[]).find((i) =>
        i.path.endsWith('.questionId'),
      );
      expect(issue, name).toMatchObject({ location: 'body' });
      expect(issue?.path).toMatch(/^answers\.\d+\.questionId$/);
      // The submitted id is never echoed back.
      expect(JSON.stringify(res.body)).not.toContain(final.questionIds[0] ?? 'x');
    }

    // Out-of-range for this question (4 options) is rejected after the schema bound of 5.
    const far = await emp.post(path, {
      sessionId: session.sessionId,
      answers: [{ questionId: good[0]?.questionId, selectedIndex: 4 }],
    });
    expect(far.status).toBe(400);
    expect(far.body.error.details.issues[0].path).toBe('answers.0.selectedIndex');
    // Duplicate question ids are caught by the schema.
    const dup = await emp.post(path, { sessionId: session.sessionId, answers: [good[0], good[0]] });
    expect(dup.status).toBe(400);

    expect(await QuizAttempt.countDocuments({})).toBe(0);
    expect((await AssessmentSession.findById(session.sessionId).lean())?.status).toBe('open');
    expect((await emp.post(path, { sessionId: session.sessionId, answers: good })).status).toBe(
      201,
    );
  });

  it('TA5b: ids are matched case-insensitively, so upper-case copies still grade', async () => {
    const t = await buildTestApp();
    const { modules, keys } = await createCurriculum({ count: 1 });
    const m1 = need(modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    const res = await emp.post(`/modules/${m1.id}/quiz/attempts`, {
      sessionId: session.sessionId.toUpperCase(),
      answers: answersFor(session, keys, 5).map((a) => ({
        ...a,
        questionId: a.questionId.toUpperCase(),
      })),
    });
    expect(res.status).toBe(201);
    expect(res.body.score).toBe(100);
  });

  it('TA6: replaying a passing body is 409; one attempt, attempts unchanged, hooks once', async () => {
    const hooks = spyHooks();
    const t = await buildTestApp({}, { learningHooks: hooks });
    const { modules, keys } = await createCurriculum({ count: 2 });
    const m1 = need(modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    const body = { sessionId: session.sessionId, answers: answersFor(session, keys, 5) };

    expect((await emp.post(`/modules/${m1.id}/quiz/attempts`, body)).status).toBe(201);
    for (let i = 0; i < 3; i += 1) {
      const replay = await emp.post(`/modules/${m1.id}/quiz/attempts`, body);
      expect(replay.status).toBe(409);
      expect(replay.body.error.code).toBe('SESSION_CLOSED');
    }
    expect(await QuizAttempt.countDocuments({})).toBe(1);
    expect((await UserProgress.findOne({ userId: emp.id }).lean())?.attempts).toBe(1);
    expect(hooks.onAttemptRecorded).toHaveBeenCalledTimes(1);
    expect(hooks.onModuleCompleted).toHaveBeenCalledTimes(1);
  });

  it("TA7: another employee cannot submit or abandon someone else's session", async () => {
    const t = await buildTestApp();
    const { modules, keys } = await createCurriculum({ count: 1 });
    const m1 = need(modules[0]);
    const a = await signedInEmployee(t.app, creds);
    const b = await signedInEmployee(t.app, creds);
    await completeContent(a, m1);
    await completeContent(b, m1);
    const { session } = await startQuiz(a, m1.id);

    const submit = await b.post(`/modules/${m1.id}/quiz/attempts`, {
      sessionId: session.sessionId,
      answers: answersFor(session, keys, 5),
    });
    expect(submit.status).toBe(404);
    const unknown = await b.post(`/modules/${m1.id}/quiz/attempts`, {
      sessionId: new Types.ObjectId().toHexString(),
      answers: [],
    });
    // Same response as a session that does not exist at all.
    expect(submit.body).toEqual(unknown.body);
    expect(
      (await b.post(`/modules/${m1.id}/quiz/sessions/${session.sessionId}/abandon`)).status,
    ).toBe(404);
    expect((await AssessmentSession.findById(session.sessionId).lean())?.status).toBe('open');
    expect(await QuizAttempt.countDocuments({})).toBe(0);
    // And A can still submit it.
    expect((await submitQuiz(a, m1.id, session, keys, 5)).status).toBe(201);
  });

  it('TA8: after the time limit a submission is 409 SESSION_EXPIRED and an expired attempt is recorded', async () => {
    const hooks = spyHooks();
    const t = await buildTestApp(
      { learning: { sessionTtlSeconds: 300 } },
      { learningHooks: hooks },
    );
    const { modules, keys } = await createCurriculum({ count: 2 });
    const m1 = need(modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    const body = { sessionId: session.sessionId, answers: answersFor(session, keys, 5) };

    t.advance(299_000);
    // Still inside the limit: this would pass. Do not submit; step over the limit instead.
    t.advance(2_000);
    const res = await emp.post(`/modules/${m1.id}/quiz/attempts`, body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');

    const attempts = await QuizAttempt.find({}).lean();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ endReason: 'expired', passed: false, score: 0 });
    const row = await UserProgress.findOne({ userId: emp.id }).lean();
    expect(row).toMatchObject({ quizPassed: false, attempts: 1 });
    expect(hooks.onAttemptRecorded).toHaveBeenCalledTimes(1);
    expect(hooks.onModuleCompleted).not.toHaveBeenCalled();

    // A second try is simply closed.
    const again = await emp.post(`/modules/${m1.id}/quiz/attempts`, body);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SESSION_CLOSED');
    // The employee can start over.
    expect((await startQuiz(emp, m1.id)).res.status).toBe(201);
  });

  it('TA8b: a submission just inside the limit is accepted', async () => {
    const t = await buildTestApp({ learning: { sessionTtlSeconds: 300 } });
    const { modules, keys } = await createCurriculum({ count: 1 });
    const m1 = need(modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    t.advance(299_000);
    expect((await submitQuiz(emp, m1.id, session, keys, 5)).status).toBe(201);
  });

  it('TA9: an administrator token is refused on every learning route', async () => {
    const t = await buildTestApp();
    const { modules } = await createCurriculum({ count: 1 });
    const m1 = need(modules[0]);
    const admin = await createAdmin(creds);
    const { accessToken } = await loginOk(t.app, admin);
    const adm = clientFor(t.app, admin, accessToken);
    const id = new Types.ObjectId().toHexString();
    const calls = [
      adm.get('/modules'),
      adm.get(`/modules/${m1.id}`),
      adm.post(`/modules/${m1.id}/start`),
      adm.post(`/modules/${m1.id}/exercises/${id}/answers`, { selectedIndex: 0 }),
      adm.post(`/modules/${m1.id}/content/complete`),
      adm.get(`/modules/${m1.id}/quiz`),
      adm.post(`/modules/${m1.id}/quiz/sessions`),
      adm.post(`/modules/${m1.id}/quiz/sessions/${id}/abandon`),
      adm.post(`/modules/${m1.id}/quiz/attempts`, { sessionId: id, answers: [] }),
      adm.get('/final-test'),
      adm.post('/final-test/sessions'),
      adm.post(`/final-test/sessions/${id}/abandon`),
      adm.post('/final-test/attempts', { sessionId: id, answers: [] }),
      adm.get('/me/attempts'),
      adm.get(`/me/attempts/${id}`),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect(await UserProgress.countDocuments({})).toBe(0);
  });
});
