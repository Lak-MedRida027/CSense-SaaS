import { Types } from 'mongoose';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { finalTestOverviewSchema } from '@csense/shared';
import { missingLearningIndexes, ensureLearningIndexes } from '../src/db/learningIndexes.js';
import {
  AssessmentSession,
  AttemptCounter,
  AuditLog,
  AuditLogImmutableError,
  QuizAttempt,
  UserProgress,
} from '../src/models/index.js';
import { buildTestApp, makeCredentials } from './helpers/fixtures.js';
import {
  answersFor,
  completeContent,
  createCurriculum,
  createFinalTest,
  passModule,
  signedInEmployee,
  spyHooks,
  startQuiz,
  submitQuiz,
} from './helpers/learningFixtures.js';
import { toAppConfig } from '../src/config/appConfig.js';
import { loadEnv } from '../src/config/env.js';
import { randomSecret } from './helpers/testConfig.js';

let creds: { password: string; hash: string };

beforeAll(async () => {
  creds = await makeCredentials();
});

const need = <T>(v: T | undefined): T => {
  if (v === undefined) throw new Error('fixture');
  return v;
};

describe('idempotent session start (P3-L6)', () => {
  it('a repeat start inside the reuse window returns the same open session and records no attempt', async () => {
    const t = await buildTestApp({ learning: { startReuseSeconds: 5 } });
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);

    const first = (await startQuiz(emp, m1.id)).session;
    const again = await startQuiz(emp, m1.id);
    expect(again.res.status).toBe(201);
    expect(again.session).toEqual(first);
    expect(await QuizAttempt.countDocuments({})).toBe(0);
    expect(await AssessmentSession.countDocuments({ status: 'open' })).toBe(1);

    // After the window the old one is abandoned (D5) and a new one is issued.
    t.advance(6_000);
    const later = (await startQuiz(emp, m1.id)).session;
    expect(later.sessionId).not.toBe(first.sessionId);
    expect(later.attemptNumber).toBe(2);
    expect(await QuizAttempt.countDocuments({ endReason: 'abandoned' })).toBe(1);
  });

  it('an expired session is never reused', async () => {
    const t = await buildTestApp({ learning: { startReuseSeconds: 60, sessionTtlSeconds: 300 } });
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const first = (await startQuiz(emp, m1.id)).session;
    t.advance(301_000);
    const next = (await startQuiz(emp, m1.id)).session;
    expect(next.sessionId).not.toBe(first.sessionId);
    expect((await QuizAttempt.findOne({}).lean())?.endReason).toBe('expired');
  });

  it('the reused session still grades normally', async () => {
    const t = await buildTestApp({ learning: { startReuseSeconds: 5 } });
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    await startQuiz(emp, m1.id);
    const { session } = await startQuiz(emp, m1.id);
    expect((await submitQuiz(emp, m1.id, session, c.keys, 5)).body).toMatchObject({
      passed: true,
      attemptNumber: 1,
    });
  });
});

describe('per-employee session-start throttle (P3-L6)', () => {
  it('answers 429 RATE_LIMITED with Retry-After, per employee, shared by quiz and final test', async () => {
    const t = await buildTestApp({ rateLimit: { sessionStartMax: 3 } });
    const c = await createCurriculum({ count: 1 });
    await createFinalTest(c.keys, 5);
    const m1 = need(c.modules[0]);
    const a = await signedInEmployee(t.app, creds);
    const b = await signedInEmployee(t.app, creds);
    await completeContent(a, m1);
    await completeContent(b, m1);

    for (let i = 0; i < 3; i += 1)
      expect((await a.post(`/modules/${m1.id}/quiz/sessions`)).status).toBe(201);
    const blocked = await a.post(`/modules/${m1.id}/quiz/sessions`);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    // The final-test route draws on the same per-employee budget (and is gated first: 403 here).
    expect((await a.post('/final-test/sessions')).status).toBe(429);
    // Another employee, same IP, is unaffected.
    expect((await b.post(`/modules/${m1.id}/quiz/sessions`)).status).toBe(201);
    // Reads and submissions are not throttled by it.
    expect((await a.get('/modules')).status).toBe(200);
  });

  it('is not bypassed by the IP: the key is the employee id, not the address', async () => {
    const t = await buildTestApp({ rateLimit: { sessionStartMax: 2 } });
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const a = await signedInEmployee(t.app, creds);
    await completeContent(a, m1);
    const post = () =>
      request(t.app)
        .post(`/api/v1/modules/${m1.id}/quiz/sessions`)
        .set('Authorization', `Bearer ${a.token}`)
        .set('X-Forwarded-For', `10.0.0.${String(Math.floor(Math.random() * 200))}`)
        .send({});
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(429);
  });
});

describe('attempt numbers and the ledger (P3-L2)', () => {
  it('numbers are allocated atomically at start and are unique in the stored history', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 1, passingScore: 100 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const numbers: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const { session } = await startQuiz(emp, m1.id);
      numbers.push(session.attemptNumber);
      await submitQuiz(emp, m1.id, session, c.keys, 2);
    }
    expect(numbers).toEqual([1, 2, 3, 4]);
    const stored = (await QuizAttempt.find({}).sort({ attemptNumber: 1 }).lean()).map(
      (a) => a.attemptNumber,
    );
    expect(stored).toEqual([1, 2, 3, 4]);
    // The unique index refuses a duplicate number outright.
    const one = await QuizAttempt.findOne({ attemptNumber: 1 }).lean();
    await expect(
      QuizAttempt.collection.insertOne({ ...one, _id: undefined, sessionId: undefined } as never),
    ).rejects.toBeDefined();
  });

  it('the final-test overview reads the ledger: attempts, best score, no aggregation', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 1 });
    await createFinalTest(c.keys, 10);
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await passModule(emp, m1, c.keys);
    const aggregate = vi.spyOn(QuizAttempt, 'aggregate');
    const s1 = (await emp.post('/final-test/sessions')).body;
    await emp.post('/final-test/attempts', {
      sessionId: s1.sessionId,
      answers: answersFor(s1, c.keys, 6),
    });
    const s2 = (await emp.post('/final-test/sessions')).body;
    await emp.post(`/final-test/sessions/${s2.sessionId}/abandon`);
    const overview = finalTestOverviewSchema.parse((await emp.get('/final-test')).body);
    expect(overview).toMatchObject({ attempts: 2, bestScore: 60, passed: false });
    expect(aggregate).not.toHaveBeenCalled();
    aggregate.mockRestore();
    const ledger = await AttemptCounter.findOne({ assessmentId: overview.finalTestId }).lean();
    expect(ledger).toMatchObject({ seq: 2, attempts: 2, bestScore: 60, firstPassAt: null });
  });

  it('a submit on an open session whose assessment has since been passed is 409 ALREADY_PASSED', async () => {
    const hooks = spyHooks();
    const t = await buildTestApp({}, { learningHooks: hooks });
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session: stale } = await startQuiz(emp, m1.id);
    // The pass lands through another (planted) session while this one is still open.
    await AssessmentSession.updateOne({ _id: stale.sessionId }, { status: 'abandoned' });
    await passModule(emp, m1, c.keys);
    await AssessmentSession.updateOne({ _id: stale.sessionId }, { status: 'open' });
    const res = await submitQuiz(emp, m1.id, stale, c.keys, 5);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_PASSED');
    expect(hooks.onModuleCompleted).toHaveBeenCalledTimes(1);
  });
});

describe('repair-on-read of a lost progress write (P3-L1)', () => {
  it('a passing attempt in the history counts as passed, repairs the row and never re-fires the hook', async () => {
    const hooks = spyHooks();
    const t = await buildTestApp({}, { learningHooks: hooks });
    const c = await createCurriculum({ count: 2 });
    const [m1, m2] = [need(c.modules[0]), need(c.modules[1])];
    const emp = await signedInEmployee(t.app, creds);
    await passModule(emp, m1, c.keys);
    // Simulate the lost progress write.
    await UserProgress.collection.updateOne(
      { moduleId: { $exists: true } },
      { $set: { quizPassed: false, status: 'in_progress' }, $unset: { completedAt: '' } },
    );
    expect((await UserProgress.findOne({ userId: emp.id }).lean())?.quizPassed).toBe(false);

    const overview = await emp.get('/modules');
    expect((overview.body.modules as { status: string }[]).map((m) => m.status)).toEqual([
      'completed',
      'unlocked',
    ]);
    expect((await emp.get(`/modules/${m2.id}`)).status).toBe(200);
    const repaired = await UserProgress.findOne({ userId: emp.id, moduleId: m1.id }).lean();
    expect(repaired).toMatchObject({ quizPassed: true, status: 'completed' });
    // The quiz is closed, so no later attempt can complete the module a second time.
    const again = await startQuiz(emp, m1.id);
    expect(again.res.status).toBe(409);
    expect(again.res.body.error.code).toBe('ALREADY_PASSED');
    expect(hooks.onModuleCompleted).toHaveBeenCalledTimes(1);
  });
});

describe('startup indexes and readiness (P3-L3)', () => {
  it('ready while every required unique index exists; 503 when one is missing; the check is cached', async () => {
    const t = await buildTestApp();
    expect(await missingLearningIndexes()).toEqual([]);
    expect((await request(t.app).get('/api/v1/health/ready')).status).toBe(200);

    await AssessmentSession.collection.dropIndex('one_open_session');
    try {
      expect(await missingLearningIndexes()).toEqual(['assessmentsessions.one_open_session']);
      // A good result is trusted for 30 seconds, then the check runs again.
      expect((await request(t.app).get('/api/v1/health/ready')).status).toBe(200);
      t.advance(31_000);
      const down = await request(t.app).get('/api/v1/health/ready');
      expect(down.status).toBe(503);
      expect(down.body).toEqual({ status: 'unavailable' });
    } finally {
      await ensureLearningIndexes();
    }
    // A failure is never cached: recovery shows at once.
    expect((await request(t.app).get('/api/v1/health/ready')).status).toBe(200);
  });

  it('ensureLearningIndexes fails loudly when an index cannot be built', async () => {
    await AssessmentSession.collection.dropIndex('one_open_session');
    const base = {
      userId: new Types.ObjectId(),
      kind: 'FinalTest',
      assessmentId: new Types.ObjectId(),
      status: 'open',
      passingScore: 70,
      expiresAt: new Date(Date.now() + 60_000),
      questions: [{ questionId: 'q', optionCount: 2, correctAnswer: 0 }],
    };
    try {
      await AssessmentSession.collection.insertMany([{ ...base }, { ...base }]);
      await expect(ensureLearningIndexes()).rejects.toThrow(/one_open_session/);
    } finally {
      await AssessmentSession.collection.deleteMany({});
      await ensureLearningIndexes();
    }
  });
});

describe('hook timeout (P3-L5) and aggregate guard (P3-L4)', () => {
  it('a hook slower than LEARNING_HOOK_TIMEOUT_MS is dropped quickly; effects of a fast hook still apply', async () => {
    const hung = new Promise<undefined>(() => undefined);
    const hooks = {
      ...spyHooks(),
      onAttemptRecorded: vi.fn(() => hung),
      onModuleCompleted: vi.fn(() => Promise.resolve({ xpEarned: 40 })),
    };
    const t = await buildTestApp({ learning: { hookTimeoutMs: 150 } }, { learningHooks: hooks });
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    const started = Date.now();
    const res = await submitQuiz(emp, m1.id, session, c.keys, 5);
    expect(Date.now() - started).toBeLessThan(2500);
    expect(res.status).toBe(201);
    expect(res.body.effects).toEqual({ xpEarned: 40 });
    expect(await QuizAttempt.countDocuments({ passed: true })).toBe(1);
  });

  it('$out and $merge are refused on QuizAttempt and AuditLog; plain aggregations still work', async () => {
    await expect(
      QuizAttempt.aggregate([{ $match: {} }, { $out: 'quizattempts_copy' }]).exec(),
    ).rejects.toThrow(/append-only/);
    await expect(
      AuditLog.aggregate([{ $match: {} }, { $merge: { into: 'auditlogs' } }]).exec(),
    ).rejects.toBeInstanceOf(AuditLogImmutableError);
    await expect(
      AuditLog.aggregate([{ $match: {} }, { $count: 'n' }]).exec(),
    ).resolves.toBeDefined();
    await expect(QuizAttempt.aggregate([{ $count: 'n' }]).exec()).resolves.toBeDefined();
  });
});

describe('configuration', () => {
  const base = () => ({
    MONGODB_URI: 'mongodb://127.0.0.1:27017/csense',
    JWT_ACCESS_SECRET: randomSecret(),
    REFRESH_TOKEN_SECRET: randomSecret(),
    AUDIT_CHAIN_SECRET: randomSecret(),
  });

  it('new keys have documented defaults and bounds', () => {
    const cfg = toAppConfig(loadEnv(base()));
    expect(cfg.learning).toEqual({
      sessionTtlSeconds: 3600,
      hookTimeoutMs: 2000,
      startReuseSeconds: 5,
      cooldownAfterFails: 3,
      cooldownMinutes: 15,
    });
    expect(cfg.rateLimit.sessionStartMax).toBe(10);
    expect(cfg.rateLimit.sessionStartWindowMs).toBe(600_000);
    for (const [key, bad] of [
      ['LEARNING_HOOK_TIMEOUT_MS', '99'],
      ['LEARNING_HOOK_TIMEOUT_MS', '30001'],
      ['ASSESSMENT_START_REUSE_SECONDS', '-1'],
      ['ASSESSMENT_START_REUSE_SECONDS', '61'],
      ['SESSION_START_RATE_MAX', '0'],
      ['SESSION_START_RATE_WINDOW_MS', '0'],
    ] as const) {
      expect(() => loadEnv({ ...base(), [key]: bad }), `${key}=${bad}`).toThrow(new RegExp(key));
    }
    expect(
      loadEnv({ ...base(), ASSESSMENT_START_REUSE_SECONDS: '0' }).ASSESSMENT_START_REUSE_SECONDS,
    ).toBe(0);
  });
});
