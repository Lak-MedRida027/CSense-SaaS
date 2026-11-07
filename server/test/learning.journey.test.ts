import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  assessmentSessionSchema,
  attemptListSchema,
  attemptResultSchema,
  finalTestOverviewSchema,
  learningOverviewSchema,
  moduleDetailSchema,
  type AssessmentSessionDTO,
  type LearningOverviewDTO,
} from '@csense/shared';
import { Quiz } from '../src/models/index.js';
import { seedLearningContent } from '../src/scripts/seedLearning.js';
import {
  buildTestApp,
  createAdmin,
  login,
  loginOk,
  makeCredentials,
  randomPassword,
  uniqueEmail,
} from './helpers/fixtures.js';
import {
  answersFor,
  clientFor,
  loadKeys,
  scanForKeys,
  syncLearningIndexes,
} from './helpers/learningFixtures.js';

/**
 * The Phase 3 gate (D3-17): the whole learning journey over HTTP, on the real seed, as a real
 * employee created by an administrator. Answer keys are read through the test-only DB handle.
 */
interface Logged {
  method: string;
  path: string;
  status: number;
  body: unknown;
}

describe('Phase 3 gate journey', () => {
  const log: Logged[] = [];
  let api: ReturnType<typeof recording>;
  let moduleIds: string[] = [];
  const keys = new Map<string, number>();

  function recording(client: ReturnType<typeof clientFor>) {
    const track = async (
      method: string,
      path: string,
      run: () => PromiseLike<request.Response>,
    ) => {
      const res = await run();
      log.push({ method, path, status: res.status, body: res.body });
      return res;
    };
    return {
      get: (p: string) => track('GET', p, () => client.get(p)),
      post: (p: string, b?: object) => track('POST', p, () => client.post(p, b)),
      patch: (p: string, b?: object) => track('PATCH', p, () => client.patch(p, b)),
      userId: client.id,
    };
  }

  const overview = async (): Promise<LearningOverviewDTO> =>
    learningOverviewSchema.parse((await api.get('/modules')).body);

  async function completeContent(moduleId: string): Promise<void> {
    const detail = moduleDetailSchema.parse((await api.get(`/modules/${moduleId}`)).body);
    expect((await api.post(`/modules/${moduleId}/start`)).status).toBe(200);
    for (const ex of detail.content.exercises) {
      const res = await api.post(`/modules/${moduleId}/exercises/${ex.exerciseId}/answers`, {
        selectedIndex: 0,
      });
      expect(res.status).toBe(200);
    }
    expect((await api.post(`/modules/${moduleId}/content/complete`)).status).toBe(200);
  }

  async function startQuiz(moduleId: string): Promise<AssessmentSessionDTO> {
    const res = await api.post(`/modules/${moduleId}/quiz/sessions`);
    expect(res.status).toBe(201);
    return assessmentSessionSchema.parse(res.body);
  }

  beforeAll(async () => {
    await syncLearningIndexes();
    await seedLearningContent({ nodeEnv: 'test' });
    const quizzes = await Quiz.find({}).select('moduleId').lean();
    for (const q of quizzes) {
      for (const [id, k] of await loadKeys(q._id.toHexString())) keys.set(id, k);
    }

    // A real employee: created by an administrator over the API, then signed in.
    const t = await buildTestApp();
    const creds = await makeCredentials();
    const admin = await createAdmin(creds);
    const adminToken = (await loginOk(t.app, admin)).accessToken;
    const password = randomPassword();
    const email = uniqueEmail('journey');
    const created = await clientFor(t.app, admin, adminToken).post('/admin/users', {
      name: 'Journey Employee',
      email,
      password,
      role: 'employee',
    });
    expect(created.status).toBe(201);
    const { res, body } = await login(t.app, { email, password });
    expect(res.status).toBe(200);
    api = recording(clientFor(t.app, { id: created.body.id as string, email }, body.accessToken));
  });

  it('walks the whole gate', async () => {
    // 1. Nothing is done yet: module 1 is open, 2..7 and the final test are locked.
    const first = await overview();
    expect(first.modules).toHaveLength(7);
    expect(first.modules.map((m) => m.status)).toEqual([
      'unlocked',
      ...Array<string>(6).fill('locked'),
    ]);
    expect(first.finalTest).toMatchObject({
      status: 'locked',
      questionCount: 15,
      remainingModules: 7,
    });
    moduleIds = first.modules.map((m) => m.id);
    const [m1 = '', m2 = '', m3 = ''] = moduleIds;

    // 2. A locked module is refused, and so is its quiz.
    const locked = await api.get(`/modules/${m2}`);
    expect(locked.status).toBe(403);
    expect(locked.body.error.code).toBe('MODULE_LOCKED');
    expect((await api.post(`/modules/${m2}/quiz/sessions`)).status).toBe(403);

    // 3. A forged pass is rejected, with and without a real session.
    const forgedBody = { sessionId: '0'.repeat(24), answers: [], passed: true, score: 100 };
    expect((await api.post(`/modules/${m1}/quiz/attempts`, forgedBody)).status).toBe(400);
    await completeContent(m1);
    const sessionA = await startQuiz(m1);
    const forgedReal = await api.post(`/modules/${m1}/quiz/attempts`, {
      sessionId: sessionA.sessionId,
      answers: answersFor(sessionA, keys, 5),
      passed: true,
      score: 100,
    });
    expect(forgedReal.status).toBe(400);
    expect((await api.patch('/me/progress', { status: 'completed' })).status).toBe(404);
    expect((await overview()).modules[1]?.status).toBe('locked');

    // 4. A failed quiz blocks progress.
    const failed = await api.post(`/modules/${m1}/quiz/attempts`, {
      sessionId: sessionA.sessionId,
      answers: answersFor(sessionA, keys, 2),
    });
    expect(failed.status).toBe(201);
    expect(attemptResultSchema.parse(failed.body)).toMatchObject({
      passed: false,
      score: 40,
      progression: { moduleCompleted: false },
    });
    expect((await overview()).modules.map((m) => m.status).slice(0, 2)).toEqual([
      'in_progress',
      'locked',
    ]);
    expect((await api.get(`/modules/${m2}/quiz`)).status).toBe(403);

    // 5. A passed quiz unlocks the next module, and only that one.
    const sessionB = await startQuiz(m1);
    expect(sessionB.attemptNumber).toBe(2);
    const passBody = { sessionId: sessionB.sessionId, answers: answersFor(sessionB, keys, 5) };
    const passed = await api.post(`/modules/${m1}/quiz/attempts`, passBody);
    expect(passed.status).toBe(201);
    expect(attemptResultSchema.parse(passed.body)).toMatchObject({
      passed: true,
      score: 100,
      progression: { moduleCompleted: true, nextModuleId: m2 },
    });
    const afterOne = await overview();
    expect(afterOne.modules.map((m) => m.status)).toEqual([
      'completed',
      'unlocked',
      ...Array<string>(5).fill('locked'),
    ]);
    expect(afterOne.modules[2]?.id).toBe(m3);
    expect((await api.get(`/modules/${m3}`)).status).toBe(403);

    // 6. Replaying the winning body is refused, and the history holds exactly two attempts.
    const replay = await api.post(`/modules/${m1}/quiz/attempts`, passBody);
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe('SESSION_CLOSED');
    const history = attemptListSchema.parse((await api.get(`/me/attempts?moduleId=${m1}`)).body);
    expect(history.items.map((a) => [a.attemptNumber, a.passed])).toEqual([
      [2, true],
      [1, false],
    ]);

    // 7. Modules 2..7: the final test opens only after module 7.
    for (const [i, id] of moduleIds.entries()) {
      if (i === 0) continue;
      await completeContent(id);
      const s = await startQuiz(id);
      const res = await api.post(`/modules/${id}/quiz/attempts`, {
        sessionId: s.sessionId,
        answers: answersFor(s, keys, s.questions.length),
      });
      expect(res.status).toBe(201);
      expect(res.body.passed).toBe(true);
      const state = await overview();
      expect(state.modules.filter((m) => m.status === 'completed')).toHaveLength(i + 1);
      expect(state.finalTest?.status).toBe(i === 6 ? 'unlocked' : 'locked');
      if (i < 6) {
        const early = await api.post('/final-test/sessions');
        expect(early.status).toBe(403);
        expect(early.body.error.code).toBe('FINAL_TEST_LOCKED');
      }
    }

    // 8. The final test: fail, then pass. The dashboard data then reads 7 of 7 plus the final test.
    const finalKeys = await loadKeys(
      finalTestOverviewSchema.parse((await api.get('/final-test')).body).finalTestId,
    );
    for (const [id, k] of finalKeys) keys.set(id, k);
    const f1 = assessmentSessionSchema.parse((await api.post('/final-test/sessions')).body);
    expect(f1.questions).toHaveLength(15);
    const f1Res = await api.post('/final-test/attempts', {
      sessionId: f1.sessionId,
      answers: answersFor(f1, keys, 10),
    });
    expect(f1Res.status).toBe(201);
    expect(f1Res.body).toMatchObject({ passed: false, score: 66 });
    const f2 = assessmentSessionSchema.parse((await api.post('/final-test/sessions')).body);
    const f2Res = await api.post('/final-test/attempts', {
      sessionId: f2.sessionId,
      answers: answersFor(f2, keys, 11),
    });
    expect(f2Res.body).toMatchObject({ passed: true, score: 73 });

    const done = await overview();
    expect(done.completedCount).toBe(7);
    expect(done.modules.every((m) => m.status === 'completed')).toBe(true);
    expect(done.finalTest).toMatchObject({ status: 'completed', passed: true, attempts: 2 });
    expect(done.nextModuleId).toBeNull();

    // 9. Deep scan of everything the server said during the journey.
    expect(log.length).toBeGreaterThan(50);
    for (const entry of log) {
      const where = `${entry.method} ${entry.path} -> ${String(entry.status)}`;
      const isExerciseFeedback = /\/exercises\/[a-f0-9]+\/answers$/.test(entry.path);
      const isAttemptReview = /\/(attempts|abandon)/.test(entry.path) && entry.status < 300;
      const found = scanForKeys(entry.body);
      if (isExerciseFeedback) continue; // the one place a key is meant to be shown, after answering
      if (isAttemptReview) {
        // Reviews may carry explanations; the correct option only once the attempt passed.
        const body = entry.body as { passed?: boolean };
        const allowed = body.passed === true ? ['correctIndex', 'explanation'] : ['explanation'];
        const leaked = found.filter((p) => !allowed.some((a) => p.endsWith(`.${a}`)));
        expect(leaked, where).toEqual([]);
        continue;
      }
      expect(found, where).toEqual([]);
    }
    // Failed attempts never showed the correct option at the time.
    for (const entry of log.filter((e) => e.path.endsWith('/attempts') && e.status === 201)) {
      const body = entry.body as { passed: boolean };
      if (!body.passed) {
        expect(scanForKeys(entry.body).filter((p) => p.endsWith('.correctIndex'))).toEqual([]);
      }
    }
  });
});
