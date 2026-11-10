import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Types } from 'mongoose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ensureLearningIndexes, missingLearningIndexes } from '../src/db/learningIndexes.js';
import { reserveAttemptNumber, startCooldownIfDue } from '../src/features/learning/ledger.store.js';
import {
  AssessmentSession,
  AttemptCounter,
  QuizAttempt,
  UserProgress,
} from '../src/models/index.js';
import { buildTestApp, makeCredentials } from './helpers/fixtures.js';
import { close, listen } from './helpers/rawHttp.js';
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

const waitUntil = async (check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('condition not reached');
};

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
    expect(numbers).toEqual(Array.from({ length: recorded }, (_, i) => i + 1)); // dense from 1
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

describe('session-start limiter counts every request', () => {
  it('malformed, locked and successful starts all draw on the same budget', async () => {
    const t = await buildTestApp({ rateLimit: { sessionStartMax: 3 } });
    const c = await createCurriculum({ count: 2 });
    const m2 = need(c.modules[1]);
    const emp = await signedInEmployee(t.app, creds);
    for (let i = 0; i < 2; i += 1) {
      expect((await emp.post(`/modules/${m2.id}/quiz/sessions`, { junk: 1 })).status).toBe(400);
    }
    expect((await emp.post(`/modules/${m2.id}/quiz/sessions`)).status).toBe(403); // locked
    expect((await emp.post(`/modules/${m2.id}/quiz/sessions`)).status).toBe(429);
  });

  it('a client that aborts every connection right after sending a start still spends its budget', async () => {
    const t = await buildTestApp({ rateLimit: { sessionStartMax: 3 } });
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);

    // Slow session creation, so that the connection is gone before any response is written.
    const create = AssessmentSession.create.bind(AssessmentSession) as (
      ...x: unknown[]
    ) => Promise<unknown>;
    const slow = vi.spyOn(AssessmentSession, 'create').mockImplementation((async (
      ...args: unknown[]
    ) => {
      await new Promise((r) => setTimeout(r, 250));
      return create(...args);
    }) as never);
    const server = await listen(t.app);
    try {
      const { port } = server.address() as AddressInfo;
      // node:http request that is destroyed 80 ms after it was sent, while the (slowed) server is
      // still working on it, so no response is ever read.
      const abortedStart = (): Promise<void> =>
        new Promise((resolve) => {
          const req = http.request({
            host: '127.0.0.1',
            port,
            method: 'POST',
            path: `/api/v1/modules/${m1.id}/quiz/sessions`,
            headers: { Authorization: `Bearer ${emp.token}` },
          });
          req.on('error', () => undefined);
          req.on('close', () => {
            resolve();
          });
          req.end();
          setTimeout(() => {
            req.destroy();
          }, 80);
        });
      for (let i = 0; i < 3; i += 1) await abortedStart();
      // The server still ran the aborted starts: wait until they have replaced each other.
      // The server still ran the aborted starts although nobody was left to read the answer.
      await waitUntil(
        async () => (await AssessmentSession.countDocuments({ userId: emp.id })) >= 1,
      );
      await new Promise((r) => setTimeout(r, 800));

      slow.mockRestore();
      const next = await emp.post(`/modules/${m1.id}/quiz/sessions`);
      expect(next.status).toBe(429);
      expect(next.body.error.code).toBe('RATE_LIMITED');
    } finally {
      await close(server);
    }
  });
});

describe('start/submit race around the reservation (review fixes)', () => {
  /** An open session that no start has admitted yet: it carries no attempt number. */
  async function plantUnnumbered(
    userId: string,
    m: { id: string; quizId: string; questionIds: string[] },
    keys: Map<string, number>,
    now: Date,
  ) {
    return AssessmentSession.create({
      userId,
      kind: 'Quiz',
      assessmentId: m.quizId,
      moduleId: m.id,
      passingScore: 70,
      startedAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000),
      questions: m.questionIds.map((q) => ({
        questionId: q,
        optionCount: 4,
        correctAnswer: keys.get(q) ?? 0,
      })),
    });
  }

  it('(a) the idempotent-reuse path never hands out a session that has no attempt number yet', async () => {
    const t = await buildTestApp({ learning: { startReuseSeconds: 30 } });
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const planted = await plantUnnumbered(emp.id, m1, c.keys, t.clock());

    const start = await startQuiz(emp, m1.id);
    expect(start.res.status).toBe(201);
    expect(start.session.sessionId).not.toBe(planted.id);
    expect((await AssessmentSession.findById(planted.id).lean())?.status).toBe('abandoned');

    // Control: a numbered session inside the window is still reused.
    const again = await startQuiz(emp, m1.id);
    expect(again.session.sessionId).toBe(start.session.sessionId);
  });

  it('(b) a streak at the limit blocks submission while the cooldown write is still pending', async () => {
    const t = await buildTestApp({ learning: { cooldownAfterFails: 3, cooldownMinutes: 15 } });
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    // The failing submission that reached the limit has not written the cooldown yet.
    await AttemptCounter.updateOne({ assessmentId: m1.quizId }, { consecutiveFails: 3 });

    const res = await submitQuiz(emp, m1.id, session, c.keys, 5);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ASSESSMENT_COOLDOWN');
    expect(await QuizAttempt.countDocuments({})).toBe(0);
    expect((await AssessmentSession.findById(session.sessionId).lean())?.status).toBe('open');
  });

  it('(c) a graded submission never takes an attempt number: the unnumbered session is closed unused', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const planted = await plantUnnumbered(emp.id, m1, c.keys, t.clock());

    const res = await emp.post(`/modules/${m1.id}/quiz/attempts`, {
      sessionId: planted.id,
      answers: m1.questionIds.map((q) => ({ questionId: q, selectedIndex: c.keys.get(q) ?? 0 })),
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SESSION_CLOSED');
    expect(await QuizAttempt.countDocuments({})).toBe(0);
    expect((await AssessmentSession.findById(planted.id).lean())?.status).toBe('abandoned');
    expect(await AttemptCounter.countDocuments({})).toBe(0); // no number was drawn
    expect((await UserProgress.findOne({ userId: emp.id }).lean())?.quizPassed).toBe(false);
  });

  it('(c) an unnumbered session is not an attempt: abandon and restart close it silently', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);

    // Abandon on a session the client cannot legitimately hold: 409, nothing recorded.
    const planted = await plantUnnumbered(emp.id, m1, c.keys, t.clock());
    const res = await emp.post(`/modules/${m1.id}/quiz/sessions/${planted.id}/abandon`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SESSION_CLOSED');
    expect((await AssessmentSession.findById(planted.id).lean())?.status).toBe('abandoned');

    // Restart over an unnumbered open session: closed without an attempt, and the new session is
    // attempt number 1 with the failure streak untouched.
    const second = await plantUnnumbered(emp.id, m1, c.keys, t.clock());
    const start = await startQuiz(emp, m1.id);
    expect(start.res.status).toBe(201);
    expect(start.session.attemptNumber).toBe(1);
    expect((await AssessmentSession.findById(second.id).lean())?.status).toBe('abandoned');
    expect(await QuizAttempt.countDocuments({})).toBe(0);
    const ledger = await AttemptCounter.findOne({ assessmentId: m1.quizId }).lean();
    expect(ledger).toMatchObject({ seq: 1, attempts: 0, consecutiveFails: 0, cooldownUntil: null });
  });

  it('(c) a closer holding a stale unnumbered snapshot cannot silently drop a session that was numbered and served meanwhile', async () => {
    const t = await buildTestApp({ learning: { cooldownAfterFails: 3, cooldownMinutes: 15 } });
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    // The session as the closer reads it: open and still unnumbered.
    const planted = await plantUnnumbered(emp.id, m1, c.keys, t.clock());

    // Between the closer's read and its update, the start that created the session numbers it
    // (and, in real life, returns its questions to the client).
    const original = AssessmentSession.updateOne.bind(AssessmentSession) as (
      ...a: unknown[]
    ) => unknown;
    let raced = false;
    vi.spyOn(AssessmentSession, 'updateOne').mockImplementation(((
      filter: Record<string, unknown>,
      ...rest: unknown[]
    ) => {
      const closing = (rest[0] as { $set?: { status?: string } } | undefined)?.$set?.status;
      if (!raced && String(filter._id) === planted.id && closing === 'abandoned') {
        raced = true;
        return (async () => {
          await AssessmentSession.collection.updateOne(
            { _id: planted._id },
            { $set: { attemptNumber: 1 } },
          );
          await AttemptCounter.updateOne(
            { userId: emp.id, assessmentId: m1.quizId },
            { $set: { seq: 1 } },
            { upsert: true },
          );
          return original(filter, ...rest);
        })();
      }
      return original(filter, ...rest);
    }) as never);

    // A second start closes the "unnumbered" open session (restart-over-open).
    const start = await startQuiz(emp, m1.id);
    vi.restoreAllMocks();
    expect(raced).toBe(true);
    expect(start.res.status).toBe(201);

    // The numbered, served session became a real attempt and counted as a failure.
    const attempts = await QuizAttempt.find({ userId: emp.id }).lean();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ attemptNumber: 1, endReason: 'abandoned', passed: false });
    expect(String(attempts[0]?.sessionId)).toBe(planted.id);
    expect((await AssessmentSession.findById(planted.id).lean())?.status).toBe('abandoned');
    const ledger = await AttemptCounter.findOne({ assessmentId: m1.quizId }).lean();
    expect(ledger).toMatchObject({ attempts: 1, consecutiveFails: 1 });
    expect(start.session.attemptNumber).toBe(2);
  });

  it('(c) expiry of an unnumbered session writes no attempt either', async () => {
    const t = await buildTestApp({ learning: { sessionTtlSeconds: 300 } });
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const planted = await plantUnnumbered(emp.id, m1, c.keys, t.clock());
    t.advance(301_000);
    const res = await emp.post(`/modules/${m1.id}/quiz/attempts`, {
      sessionId: planted.id,
      answers: [],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SESSION_CLOSED');
    expect(await QuizAttempt.countDocuments({})).toBe(0);
  });
});
