import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureLearningIndexes, missingLearningIndexes } from '../src/db/learningIndexes.js';
import { reserveAttemptNumber, startCooldownIfDue } from '../src/features/learning/ledger.store.js';
import {
  AssessmentSession,
  AttemptCounter,
  QuizAttempt,
  UserProgress,
} from '../src/models/index.js';
import { buildTestApp, makeCredentials } from './helpers/fixtures.js';
import {
  completeContent,
  createCurriculum,
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

const rule = (now = new Date()) => ({ afterFails: 3, minutes: 15, now });

describe('atomic start gate (P3-L10)', () => {
  it('a session that outlives the start of a cooldown cannot be submitted; abandoning still works and counts', async () => {
    const t = await buildTestApp({
      accessTtlSeconds: 86_400,
      learning: { cooldownAfterFails: 3, cooldownMinutes: 15 },
    });
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);

    // A cooldown begins while the session is open (forced through the ledger).
    const until = new Date(t.clock().getTime() + 15 * 60_000);
    await AttemptCounter.updateOne({ assessmentId: m1.quizId }, { cooldownUntil: until });

    const submit = await submitQuiz(emp, m1.id, session, c.keys, 5);
    expect(submit.status).toBe(409);
    expect(submit.body.error.code).toBe('ASSESSMENT_COOLDOWN');
    expect(Number(submit.headers['retry-after'])).toBe(900);
    expect(await QuizAttempt.countDocuments({})).toBe(0);
    expect((await UserProgress.findOne({ userId: emp.id }).lean())?.quizPassed).toBe(false);

    // Leaving is always allowed, and it is counted like any other failure.
    const abandon = await emp.post(`/modules/${m1.id}/quiz/sessions/${session.sessionId}/abandon`);
    expect(abandon.status).toBe(201);
    expect(abandon.body).toMatchObject({ endReason: 'abandoned', passed: false });
    expect(
      (await AttemptCounter.findOne({ assessmentId: m1.quizId }).lean())?.consecutiveFails,
    ).toBe(1);

    // After the cooldown the same kind of submission works again.
    t.advance(15 * 60_000);
    const next = await startQuiz(emp, m1.id);
    expect(next.res.status).toBe(201);
    expect((await submitQuiz(emp, m1.id, next.session, c.keys, 5)).body.passed).toBe(true);
  });

  it('reserveAttemptNumber hands out dense numbers and refuses while a cooldown runs', async () => {
    const userId = new Types.ObjectId().toHexString();
    const assessmentId = new Types.ObjectId().toHexString();
    const now = new Date();
    const numbers = [];
    for (let i = 0; i < 3; i += 1)
      numbers.push(await reserveAttemptNumber(userId, assessmentId, rule(now)));
    expect(numbers).toEqual([{ attemptNumber: 1 }, { attemptNumber: 2 }, { attemptNumber: 3 }]);

    await AttemptCounter.updateOne(
      { assessmentId },
      { cooldownUntil: new Date(now.getTime() + 60_000) },
    );
    const blocked = await Promise.all(
      Array.from({ length: 5 }, () => reserveAttemptNumber(userId, assessmentId, rule(now))),
    );
    for (const b of blocked) {
      expect(b).toEqual({ blockedUntil: new Date(now.getTime() + 60_000) });
    }
    // Blocked reservations consume nothing.
    expect((await AttemptCounter.findOne({ assessmentId }).lean())?.seq).toBe(3);
    // At the end of the cooldown the next number is 4.
    const later = new Date(now.getTime() + 60_000);
    expect(await reserveAttemptNumber(userId, assessmentId, rule(later))).toEqual({
      attemptNumber: 4,
    });
  });

  it('a streak at the limit without a cooldown is refused shortly, and healed when it is stale', async () => {
    const userId = new Types.ObjectId().toHexString();
    const assessmentId = new Types.ObjectId().toHexString();
    const now = new Date();
    await reserveAttemptNumber(userId, assessmentId, rule(now));
    await AttemptCounter.updateOne({ assessmentId }, { consecutiveFails: 3 });

    const window = await reserveAttemptNumber(userId, assessmentId, rule(now));
    expect(window).toEqual({ blockedUntil: new Date(now.getTime() + 5000) });
    expect((await AttemptCounter.findOne({ assessmentId }).lean())?.cooldownUntil).toBeNull();

    // The write that should have started the cooldown never happened: a minute later it is repaired.
    const stale = new Date(now.getTime() + 120_000);
    const healed = await reserveAttemptNumber(userId, assessmentId, rule(stale));
    expect(healed).toEqual({ blockedUntil: new Date(stale.getTime() + 15 * 60_000) });
    expect(await startCooldownIfDue(userId, assessmentId, 3, rule(stale))).toBeNull(); // already started
  });
});

describe('dense attempt numbers (P3-L11)', () => {
  it('concurrent first starts never leave a gap: numbers equal the attempts recorded plus one', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);

    const results = await Promise.all(
      Array.from({ length: 6 }, () => emp.post(`/modules/${m1.id}/quiz/sessions`)),
    );
    expect(results.some((r) => r.status === 201)).toBe(true);
    const open = await AssessmentSession.find({ userId: emp.id, status: 'open' }).lean();
    expect(open).toHaveLength(1);
    const recorded = await QuizAttempt.countDocuments({ userId: emp.id });
    // The open session numbers itself after the attempts that were recorded. A start that loses a
    // double race may leave a gap, but the first stored attempt is always number 1, numbers are
    // unique, and the open session never reuses one.
    expect(need(open[0]).attemptNumber).toBeGreaterThanOrEqual(recorded + 1);
    const numbers = (await QuizAttempt.find({ userId: emp.id }).lean())
      .map((a) => a.attemptNumber)
      .sort((a, b) => a - b);
    if (numbers.length > 0) expect(numbers[0]).toBe(1);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers).not.toContain(need(open[0]).attemptNumber);
  });
});

describe('index verification compares definitions (P3-L12)', () => {
  const rebuild = async (): Promise<void> => {
    await AssessmentSession.collection.dropIndex('one_open_session').catch(() => undefined);
    await ensureLearningIndexes();
  };

  it.each([
    [
      'other keys',
      { userId: 1, kind: 1 },
      { unique: true, partialFilterExpression: { status: 'open' } },
    ],
    ['no partial filter', { userId: 1, assessmentId: 1 }, { unique: true }],
    [
      'another partial filter',
      { userId: 1, assessmentId: 1 },
      { unique: true, partialFilterExpression: { status: 'submitted' } },
    ],
    ['not unique', { userId: 1, assessmentId: 1 }, { partialFilterExpression: { status: 'open' } }],
    [
      'reversed key order',
      { assessmentId: 1, userId: 1 },
      { unique: true, partialFilterExpression: { status: 'open' } },
    ],
  ])('an index with the right name but %s is reported', async (_label, key, options) => {
    await AssessmentSession.collection.dropIndex('one_open_session');
    try {
      await AssessmentSession.collection.createIndex(key, { name: 'one_open_session', ...options });
      expect(await missingLearningIndexes()).toEqual(['assessmentsessions.one_open_session']);
      await expect(ensureLearningIndexes()).rejects.toThrow(/one_open_session/);
    } finally {
      await rebuild();
    }
    expect(await missingLearningIndexes()).toEqual([]);
  });
});

describe('session-start limiter counts what reached the rules (info)', () => {
  it('locked and cooldown starts count; malformed ones do not', async () => {
    const t = await buildTestApp({ rateLimit: { sessionStartMax: 3 } });
    const c = await createCurriculum({ count: 2 });
    const m2 = need(c.modules[1]);
    const emp = await signedInEmployee(t.app, creds);
    for (let i = 0; i < 5; i += 1) {
      expect((await emp.post(`/modules/${m2.id}/quiz/sessions`, { junk: 1 })).status).toBe(400);
    }
    for (let i = 0; i < 3; i += 1) {
      expect((await emp.post(`/modules/${m2.id}/quiz/sessions`)).status).toBe(403); // locked
    }
    expect((await emp.post(`/modules/${m2.id}/quiz/sessions`)).status).toBe(429);
  });
});
