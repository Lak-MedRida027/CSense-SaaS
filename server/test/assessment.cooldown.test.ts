import { beforeAll, describe, expect, it } from 'vitest';
import {
  finalTestOverviewSchema,
  moduleDetailSchema,
  quizOverviewSchema,
  type AssessmentSessionDTO,
} from '@csense/shared';
import {
  claimFirstPass,
  countOnLedger,
  startCooldownIfDue,
} from '../src/features/learning/ledger.store.js';
import { AttemptCounter, AuditLog, QuizAttempt } from '../src/models/index.js';
import { buildTestApp, makeCredentials, type TestApp } from './helpers/fixtures.js';
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
  type Client,
  type TestCurriculum,
  type TestModule,
} from './helpers/learningFixtures.js';
import { Types } from 'mongoose';

let creds: { password: string; hash: string };

beforeAll(async () => {
  creds = await makeCredentials();
});

const need = <T>(v: T | undefined): T => {
  if (v === undefined) throw new Error('fixture');
  return v;
};

const cooldownApp = (
  overrides: { fails?: number; minutes?: number; ttl?: number } = {},
  options: Parameters<typeof buildTestApp>[1] = {},
): Promise<TestApp> =>
  buildTestApp(
    {
      accessTtlSeconds: 86_400, // the tests move the clock by whole cooldowns
      learning: {
        cooldownAfterFails: overrides.fails ?? 3,
        cooldownMinutes: overrides.minutes ?? 15,
        ...(overrides.ttl === undefined ? {} : { sessionTtlSeconds: overrides.ttl }),
      },
    },
    options,
  );

/** One failed submitted attempt. */
async function failOnce(emp: Client, m: TestModule, c: TestCurriculum) {
  const { res, session } = await startQuiz(emp, m.id);
  expect(res.status).toBe(201);
  const out = await submitQuiz(emp, m.id, session, c.keys, 0);
  expect(out.body.passed).toBe(false);
  return session;
}

describe('cooldown after repeated failures (P3-M1)', () => {
  it('CD1: after N consecutive fails a start is 409 ASSESSMENT_COOLDOWN; the blocked start carries the code, header and time, and changes nothing', async () => {
    const t = await cooldownApp();
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    for (let i = 0; i < 3; i += 1) await failOnce(emp, m1, c);
    const attemptsBefore = await QuizAttempt.countDocuments({});

    const blocked = await startQuiz(emp, m1.id);
    expect(blocked.res.status).toBe(409);
    expect(blocked.res.body.error.code).toBe('ASSESSMENT_COOLDOWN');
    const retryAt = new Date(blocked.res.body.error.details.retryAt as string);
    expect(retryAt.getTime() - t.clock().getTime()).toBe(15 * 60_000);
    expect(Number(blocked.res.headers['retry-after'])).toBe(900);
    // No answers, scores or ids in the body.
    expect(Object.keys(blocked.res.body.error.details)).toEqual(['retryAt']);
    expect(await QuizAttempt.countDocuments({})).toBe(attemptsBefore);

    // Retry-After counts down as time passes.
    t.advance(5 * 60_000);
    const later = await startQuiz(emp, m1.id);
    expect(later.res.status).toBe(409);
    expect(Number(later.res.headers['retry-after'])).toBe(600);
  });

  it('CD2: the overview DTOs expose cooldownUntil and block canStart', async () => {
    const t = await cooldownApp();
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);

    const before = quizOverviewSchema.parse((await emp.get(`/modules/${m1.id}/quiz`)).body);
    expect(before).toMatchObject({ cooldownUntil: null, canStart: true, blockedReason: null });

    for (let i = 0; i < 3; i += 1) await failOnce(emp, m1, c);
    const expected = new Date(t.clock().getTime() + 15 * 60_000).toISOString();
    const quiz = quizOverviewSchema.parse((await emp.get(`/modules/${m1.id}/quiz`)).body);
    expect(quiz).toMatchObject({
      cooldownUntil: expected,
      canStart: false,
      blockedReason: 'cooldown',
    });
    const detail = moduleDetailSchema.parse((await emp.get(`/modules/${m1.id}`)).body);
    expect(detail.quiz).toMatchObject({ cooldownUntil: expected, blockedReason: 'cooldown' });

    t.advance(15 * 60_000);
    const open = quizOverviewSchema.parse((await emp.get(`/modules/${m1.id}/quiz`)).body);
    expect(open).toMatchObject({ cooldownUntil: null, canStart: true });
    expect((await startQuiz(emp, m1.id)).res.status).toBe(201);
  });

  it('CD3: after the cooldown a new full streak is needed before the next one', async () => {
    const t = await cooldownApp();
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    for (let i = 0; i < 3; i += 1) await failOnce(emp, m1, c);
    t.advance(15 * 60_000);
    await failOnce(emp, m1, c);
    await failOnce(emp, m1, c);
    const third = await startQuiz(emp, m1.id);
    expect(third.res.status).toBe(201); // only two fails since the cooldown
    await submitQuiz(emp, m1.id, third.session, c.keys, 0);
    expect((await startQuiz(emp, m1.id)).res.status).toBe(409);
    expect(await AuditLog.countDocuments({ action: 'learning.assessment.cooldown' })).toBe(2);
  });

  it('CD4: a pass resets the streak', async () => {
    const t = await cooldownApp({ fails: 3 });
    const c = await createCurriculum({ count: 2 });
    const [m1, m2] = [need(c.modules[0]), need(c.modules[1])];
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    await failOnce(emp, m1, c);
    await failOnce(emp, m1, c);
    const { session } = await startQuiz(emp, m1.id);
    expect((await submitQuiz(emp, m1.id, session, c.keys, 5)).body.passed).toBe(true);

    const ledger = await AttemptCounter.findOne({ assessmentId: m1.quizId }).lean();
    expect(ledger).toMatchObject({ consecutiveFails: 0, cooldownUntil: null });
    expect(await AuditLog.countDocuments({ action: 'learning.assessment.cooldown' })).toBe(0);
    // The streak belongs to one assessment: module 2 starts clean.
    await completeContent(emp, m2);
    await failOnce(emp, m2, c);
    await failOnce(emp, m2, c);
    expect((await startQuiz(emp, m2.id)).res.status).toBe(201);
  });

  it('CD5: abandoned and expired attempts count as failures, including a start that replaces an open session', async () => {
    const t = await cooldownApp({ fails: 3, ttl: 300 });
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);

    const a = (await startQuiz(emp, m1.id)).session;
    await emp.post(`/modules/${m1.id}/quiz/sessions/${a.sessionId}/abandon`); // fail 1: abandoned
    await startQuiz(emp, m1.id);
    t.advance(301_000);
    await startQuiz(emp, m1.id); // closes the stale one as expired: fail 2
    expect(
      (await QuizAttempt.find({}).sort({ attemptNumber: 1 }).lean()).map((x) => x.endReason),
    ).toEqual(['abandoned', 'expired']);
    // Starting again replaces the open session (abandoned: fail 3), which triggers the cooldown,
    // so this very start is refused and no new session is created.
    const blocked = await startQuiz(emp, m1.id);
    expect(blocked.res.status).toBe(409);
    expect(blocked.res.body.error.code).toBe('ASSESSMENT_COOLDOWN');
    expect(await QuizAttempt.countDocuments({})).toBe(3);
    expect(await AuditLog.countDocuments({ action: 'learning.assessment.cooldown' })).toBe(1);
  });

  it('CD6: the cooldown writes one warning audit entry with actor, target and assessment, nothing more', async () => {
    const t = await cooldownApp();
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    for (let i = 0; i < 3; i += 1) await failOnce(emp, m1, c);

    const entries = await AuditLog.find({ action: 'learning.assessment.cooldown' }).lean();
    expect(entries).toHaveLength(1);
    const entry = need(entries[0]);
    expect(entry).toMatchObject({
      severity: 'warning',
      outcome: 'success',
      actorRole: 'employee',
      targetType: 'user',
    });
    expect(String(entry.actorId)).toBe(emp.id);
    expect(String(entry.targetId)).toBe(emp.id);
    expect(entry.metadata).toMatchObject({
      assessmentId: m1.quizId,
      kind: 'Quiz',
      failedAttempts: 3,
      cooldownMinutes: 15,
    });
    const serialised = JSON.stringify(entry);
    expect(serialised).not.toMatch(/answers|score|selectedIndex|questionId/i);
  });

  it('CD7: the final test has its own streak and cooldown', async () => {
    const t = await cooldownApp({ fails: 2 });
    const c = await createCurriculum({ count: 1 });
    await createFinalTest(c.keys, 10);
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await passModule(emp, m1, c.keys);

    for (let i = 0; i < 2; i += 1) {
      const s = (await emp.post('/final-test/sessions')).body as AssessmentSessionDTO;
      await emp.post('/final-test/attempts', {
        sessionId: s.sessionId,
        answers: answersFor(s, c.keys, 0),
      });
    }
    const blocked = await emp.post('/final-test/sessions');
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('ASSESSMENT_COOLDOWN');
    const overview = finalTestOverviewSchema.parse((await emp.get('/final-test')).body);
    expect(overview).toMatchObject({ canStart: false, blockedReason: 'cooldown' });
    expect(overview.cooldownUntil).toEqual(expect.any(String));
    t.advance(15 * 60_000);
    expect((await emp.post('/final-test/sessions')).status).toBe(201);
  });

  it('CD8: another employee is not affected by my cooldown', async () => {
    const t = await cooldownApp();
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const a = await signedInEmployee(t.app, creds);
    const b = await signedInEmployee(t.app, creds);
    await completeContent(a, m1);
    await completeContent(b, m1);
    for (let i = 0; i < 3; i += 1) await failOnce(a, m1, c);
    expect((await startQuiz(a, m1.id)).res.status).toBe(409);
    expect((await startQuiz(b, m1.id)).res.status).toBe(201);
  });

  it('CD9: the idempotent-start window is not a way around the cooldown', async () => {
    const t = await buildTestApp({
      learning: { cooldownAfterFails: 2, cooldownMinutes: 15, startReuseSeconds: 30 },
    });
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    await failOnce(emp, m1, c);
    await failOnce(emp, m1, c);
    const blocked = await startQuiz(emp, m1.id);
    expect(blocked.res.status).toBe(409);
    expect(blocked.res.body.error.code).toBe('ASSESSMENT_COOLDOWN');
  });

  it('CD10: the completion hook and attempts still work for a pass right after a cooldown', async () => {
    const hooks = spyHooks();
    const t = await cooldownApp({}, { learningHooks: hooks });
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    for (let i = 0; i < 3; i += 1) await failOnce(emp, m1, c);
    t.advance(15 * 60_000);
    const { session } = await startQuiz(emp, m1.id);
    expect((await submitQuiz(emp, m1.id, session, c.keys, 5)).body.passed).toBe(true);
    expect(hooks.onModuleCompleted).toHaveBeenCalledTimes(1);
  });
});

describe('cooldown under concurrency (P3-M1)', () => {
  it('CC1: failures racing on the ledger start exactly one cooldown and skip none', async () => {
    for (let round = 0; round < 5; round += 1) {
      const userId = new Types.ObjectId().toHexString();
      const assessmentId = new Types.ObjectId().toHexString();
      const rule = { afterFails: 3, minutes: 15, now: new Date() };
      const fail = (n: number) =>
        countOnLedger(userId, assessmentId, {
          attemptNumber: n,
          score: 0,
          submitted: true,
          passed: false,
          at: rule.now,
        });
      // One failure already on the books, then two race: the streak reaches the limit once.
      await fail(1);
      const streaks = await Promise.all([fail(2), fail(3)]);
      expect([...streaks].sort()).toEqual([2, 3]);
      const started = await Promise.all(
        streaks.map((streak) => startCooldownIfDue(userId, assessmentId, streak, rule)),
      );
      expect(started.filter((x) => x !== null)).toHaveLength(1);
      const ledger = await AttemptCounter.findOne({ assessmentId }).lean();
      expect(ledger?.cooldownUntil).toBeInstanceOf(Date);
      expect(ledger?.attempts).toBe(3);
    }
  });

  it('CC2: a pass racing a failure never leaves a cooldown on a passed assessment unnoticed', async () => {
    const userId = new Types.ObjectId().toHexString();
    const assessmentId = new Types.ObjectId().toHexString();
    const now = new Date();
    const base = { score: 0, submitted: true, at: now };
    await countOnLedger(userId, assessmentId, { ...base, attemptNumber: 1, passed: false });
    await countOnLedger(userId, assessmentId, { ...base, attemptNumber: 2, passed: false });
    await countOnLedger(userId, assessmentId, {
      ...base,
      attemptNumber: 3,
      passed: true,
      score: 100,
    });
    expect(await claimFirstPass(userId, assessmentId, now)).toBe(true);
    const ledger = await AttemptCounter.findOne({ assessmentId }).lean();
    expect(ledger).toMatchObject({ consecutiveFails: 0, attempts: 3 });
  });

  it('CC3: parallel failing submissions through the API trigger a single cooldown entry', async () => {
    const t = await cooldownApp({ fails: 2 });
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    await failOnce(emp, m1, c);
    const { session } = await startQuiz(emp, m1.id);
    // The same failing submission twice at once: one wins, one is SESSION_CLOSED.
    const body = { sessionId: session.sessionId, answers: answersFor(session, c.keys, 0) };
    const results = await Promise.all([
      emp.post(`/modules/${m1.id}/quiz/attempts`, body),
      emp.post(`/modules/${m1.id}/quiz/attempts`, body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await AuditLog.countDocuments({ action: 'learning.assessment.cooldown' })).toBe(1);
    expect((await startQuiz(emp, m1.id)).res.status).toBe(409);
  });
});

describe('cooldown configuration', () => {
  it('CF1: the new env keys have defaults and bounds', async () => {
    const { loadEnv } = await import('../src/config/env.js');
    const { toAppConfig } = await import('../src/config/appConfig.js');
    const { randomSecret } = await import('./helpers/testConfig.js');
    const base = () => ({
      MONGODB_URI: 'mongodb://127.0.0.1:27017/csense',
      JWT_ACCESS_SECRET: randomSecret(),
      REFRESH_TOKEN_SECRET: randomSecret(),
      AUDIT_CHAIN_SECRET: randomSecret(),
    });
    const cfg = toAppConfig(loadEnv(base())).learning;
    expect(cfg.cooldownAfterFails).toBe(3);
    expect(cfg.cooldownMinutes).toBe(15);
    expect(
      loadEnv({ ...base(), ASSESSMENT_COOLDOWN_AFTER_FAILS: '1' }).ASSESSMENT_COOLDOWN_AFTER_FAILS,
    ).toBe(1);
    expect(
      loadEnv({ ...base(), ASSESSMENT_COOLDOWN_MINUTES: '1440' }).ASSESSMENT_COOLDOWN_MINUTES,
    ).toBe(1440);
    for (const [key, bad] of [
      ['ASSESSMENT_COOLDOWN_AFTER_FAILS', '0'],
      ['ASSESSMENT_COOLDOWN_AFTER_FAILS', '-1'],
      ['ASSESSMENT_COOLDOWN_AFTER_FAILS', 'x'],
      ['ASSESSMENT_COOLDOWN_MINUTES', '0'],
      ['ASSESSMENT_COOLDOWN_MINUTES', '1441'],
      ['ASSESSMENT_COOLDOWN_MINUTES', '1.5'],
    ] as const) {
      expect(() => loadEnv({ ...base(), [key]: bad }), `${key}=${bad}`).toThrow(new RegExp(key));
    }
  });
});
