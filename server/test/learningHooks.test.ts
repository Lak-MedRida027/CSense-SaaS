import { Writable } from 'node:stream';
import { pino } from 'pino';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { attemptResultSchema } from '@csense/shared';
import { createApp } from '../src/app.js';
import type { LearningHooks } from '../src/features/learning/learningHooks.js';
import { UserProgress } from '../src/models/index.js';
import { buildTestApp, makeCredentials } from './helpers/fixtures.js';
import {
  answersFor,
  completeContent,
  createCurriculum,
  failModule,
  passModule,
  signedInEmployee,
  spyHooks,
  startQuiz,
  submitQuiz,
  syncLearningIndexes,
} from './helpers/learningFixtures.js';
import { testConfig } from './helpers/testConfig.js';

let creds: { password: string; hash: string };

beforeAll(async () => {
  creds = await makeCredentials();
  await syncLearningIndexes();
});

describe('learning hooks', () => {
  it('LH1: the spies receive the exact payloads', async () => {
    const hooks = spyHooks();
    const t = await buildTestApp({}, { learningHooks: hooks });
    const { modules, keys } = await createCurriculum({ count: 2 });
    const m1 = modules[0];
    if (!m1) throw new Error('fixture');
    const emp = await signedInEmployee(t.app, creds);
    const res = await passModule(emp, m1, keys);

    expect(hooks.onAttemptRecorded).toHaveBeenCalledTimes(1);
    expect(hooks.onAttemptRecorded).toHaveBeenCalledWith({
      userId: emp.id,
      attemptId: res.body.attemptId,
      kind: 'Quiz',
      assessmentId: m1.quizId,
      moduleId: m1.id,
      attemptNumber: 1,
      endReason: 'submitted',
      score: 100,
      passed: true,
      correctCount: 5,
      totalCount: 5,
      at: expect.any(Date),
    });
    expect(hooks.onModuleCompleted).toHaveBeenCalledWith({
      userId: emp.id,
      moduleId: m1.id,
      attemptId: res.body.attemptId,
      attemptNumber: 1,
      score: 100,
      at: expect.any(Date),
    });
    expect(hooks.onFinalTestPassed).not.toHaveBeenCalled();
  });

  it('LH2: onAttemptRecorded fires for submit, abandon and expiry', async () => {
    const hooks = spyHooks();
    const t = await buildTestApp(
      { learning: { sessionTtlSeconds: 300 } },
      { learningHooks: hooks },
    );
    const { modules, keys } = await createCurriculum({ count: 1, passingScore: 100 });
    const m1 = modules[0];
    if (!m1) throw new Error('fixture');
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);

    const a = (await startQuiz(emp, m1.id)).session;
    await submitQuiz(emp, m1.id, a, keys, 3);
    const b = (await startQuiz(emp, m1.id)).session;
    await emp.post(`/modules/${m1.id}/quiz/sessions/${b.sessionId}/abandon`);
    await startQuiz(emp, m1.id);
    t.advance(301_000);
    const c = (await startQuiz(emp, m1.id)).session;
    expect(c.attemptNumber).toBe(4);

    const reasons = hooks.onAttemptRecorded.mock.calls
      .map((call) => (call as unknown[])[0])
      .map((e) => (e as { endReason: string }).endReason);
    expect(reasons).toEqual(['submitted', 'abandoned', 'expired']);
    expect(hooks.onModuleCompleted).not.toHaveBeenCalled();
  });

  it('LH3: completion hooks fire once, on the first pass only', async () => {
    const hooks = spyHooks();
    const t = await buildTestApp({}, { learningHooks: hooks });
    const { modules, keys } = await createCurriculum({ count: 2 });
    const m1 = modules[0];
    if (!m1) throw new Error('fixture');
    const emp = await signedInEmployee(t.app, creds);

    await failModule(emp, m1, keys, 1);
    expect(hooks.onAttemptRecorded).toHaveBeenCalledTimes(1);
    expect(hooks.onModuleCompleted).not.toHaveBeenCalled();

    // A rejected submission does not call the hooks and does not consume the session.
    const { session } = await startQuiz(emp, m1.id);
    const bad = await emp.post(`/modules/${m1.id}/quiz/attempts`, {
      sessionId: session.sessionId,
      answers: [{ questionId: '0'.repeat(24), selectedIndex: 0 }],
    });
    expect(bad.status).toBe(400);
    expect(hooks.onAttemptRecorded).toHaveBeenCalledTimes(1);

    const body = { sessionId: session.sessionId, answers: answersFor(session, keys, 5) };
    expect((await emp.post(`/modules/${m1.id}/quiz/attempts`, body)).status).toBe(201);
    expect(hooks.onAttemptRecorded).toHaveBeenCalledTimes(2);
    expect(hooks.onModuleCompleted).toHaveBeenCalledTimes(1);

    // Replay and a new session on a passed quiz change nothing.
    expect((await emp.post(`/modules/${m1.id}/quiz/attempts`, body)).status).toBe(409);
    expect((await startQuiz(emp, m1.id)).res.status).toBe(409);
    expect(hooks.onAttemptRecorded).toHaveBeenCalledTimes(2);
    expect(hooks.onModuleCompleted).toHaveBeenCalledTimes(1);
  });

  it('LH4: effects returned by the hooks appear in the response, whitelisted', async () => {
    const hooks: LearningHooks = {
      onAttemptRecorded: () => Promise.resolve({ xpEarned: 10 }),
      onModuleCompleted: () =>
        Promise.resolve({
          xpEarned: 40,
          badge: { id: 'b1', name: 'Phish Spotter', iconMotif: 'hook' },
          // Anything else a careless hook returns must not reach the client.
          secret: 'do-not-leak',
        } as never),
      onFinalTestPassed: () => Promise.resolve(undefined),
    };
    const t = await buildTestApp({}, { learningHooks: hooks });
    const { modules, keys } = await createCurriculum({ count: 2 });
    const m1 = modules[0];
    if (!m1) throw new Error('fixture');
    const emp = await signedInEmployee(t.app, creds);

    const res = await passModule(emp, m1, keys);
    expect(attemptResultSchema.parse(res.body).effects).toEqual({
      xpEarned: 50,
      badge: { id: 'b1', name: 'Phish Spotter', iconMotif: 'hook' },
    });
    expect(JSON.stringify(res.body)).not.toContain('do-not-leak');
  });

  it('LH5: a throwing hook still yields 201 without effects; progress is committed and the error is logged', async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const onModuleCompletedSpy = vi.fn(() => Promise.reject(new Error('boom-module')));
    const hooks: LearningHooks = {
      onAttemptRecorded: vi.fn(() => Promise.reject(new Error('boom-attempt'))),
      onModuleCompleted: onModuleCompletedSpy,
      onFinalTestPassed: () => Promise.resolve(undefined),
    };
    const app = await createApp({
      logger: pino({ level: 'error' }, sink),
      config: testConfig(),
      learningHooks: hooks,
    });
    const { modules, keys } = await createCurriculum({ count: 2 });
    const m1 = modules[0];
    if (!m1) throw new Error('fixture');
    const emp = await signedInEmployee(app, creds);

    const res = await passModule(emp, m1, keys);
    expect(attemptResultSchema.parse(res.body).effects).toEqual({});
    expect(onModuleCompletedSpy).toHaveBeenCalledTimes(1);
    const row = await UserProgress.findOne({ userId: emp.id, moduleId: m1.id }).lean();
    expect(row).toMatchObject({ quizPassed: true, status: 'completed' });

    const logged = lines.join('');
    expect(logged).toContain('Learning hook failed');
    expect(logged).toContain('onAttemptRecorded');
    expect(logged).toContain('onModuleCompleted');
    // The next module is open despite the failed hooks.
    expect((await emp.get(`/modules/${modules[1]?.id ?? ''}`)).status).toBe(200);
  });
});
