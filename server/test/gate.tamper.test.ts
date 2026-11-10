import { Types } from 'mongoose';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GateAnswer, GateRun } from '../src/models/index.js';
import { loginOk, makeCredentials } from './helpers/fixtures.js';
import {
  allKeys,
  answerRight,
  answerWrong,
  buildGateApp,
  createGateQuestions,
  gateEmployee,
  getStatus,
  keyFor,
  openChallenge,
  postAttempt,
  postChallenge,
  type GateApp,
} from './helpers/gateFixtures.js';
import { syncLearningIndexes } from './helpers/learningFixtures.js';

let creds: Awaited<ReturnType<typeof makeCredentials>>;
let t: GateApp;

beforeAll(async () => {
  creds = await makeCredentials();
  await syncLearningIndexes();
});

beforeEach(async () => {
  t = await buildGateApp();
  await createGateQuestions(8);
});

const attemptsUsed = async (userId: string): Promise<number> =>
  (await GateRun.findOne({ userId: new Types.ObjectId(userId) }).lean())?.attemptsUsed ?? -1;

describe('gate tamper resistance', () => {
  it('GT9: a body with correct, passed, score or any extra field is a 400 and consumes nothing', async () => {
    const e = await gateEmployee(t.app, creds);
    const { challenge } = await openChallenge(t.app, e.token);
    const base = { challengeId: challenge?.challengeId, selectedIndex: 0 };
    for (const extra of [
      { correct: true },
      { passed: true },
      { score: 100 },
      { correctAnswer: 1 },
      { userId: e.id },
      { anything: 'else' },
    ]) {
      const res = await postAttempt(t.app, e.token, { ...base, ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    for (const bad of [
      {},
      { challengeId: challenge?.challengeId },
      { selectedIndex: 0 },
      { challengeId: 'not-an-id', selectedIndex: 0 },
      { challengeId: challenge?.challengeId, selectedIndex: '0' },
      { challengeId: challenge?.challengeId, selectedIndex: null },
      { challengeId: { $ne: null }, selectedIndex: 0 },
    ]) {
      const res = await postAttempt(t.app, e.token, bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(await attemptsUsed(e.id)).toBe(0);
  });

  it('GT10: an index outside the served options is a 400 and no attempt is consumed', async () => {
    const e = await gateEmployee(t.app, creds);
    const { challenge } = await openChallenge(t.app, e.token);
    for (const selectedIndex of [4, 5, 6, -1, 1.5, 99]) {
      const res = await postAttempt(t.app, e.token, {
        challengeId: challenge?.challengeId,
        selectedIndex,
      });
      expect(res.status, String(selectedIndex)).toBe(400);
    }
    expect(await attemptsUsed(e.id)).toBe(0);
    expect(await GateAnswer.countDocuments({})).toBe(0);
    // The same challenge is still answerable.
    const ok = await answerRight(t.app, e, challenge?.challengeId ?? '');
    expect(ok.status).toBe(201);
  });

  it('GT11: a replayed, stale, unknown or closed challenge id is a 409 and nothing is consumed', async () => {
    const e = await gateEmployee(t.app, creds);
    const first = (await openChallenge(t.app, e.token)).challenge;
    const wrong = await answerWrong(t.app, e, first?.challengeId ?? '');
    expect(wrong.status).toBe(201);
    // Replay of the answered challenge.
    const replay = await postAttempt(t.app, e.token, {
      challengeId: first?.challengeId,
      selectedIndex: 0,
    });
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe('GATE_CHALLENGE_STALE');
    expect(await attemptsUsed(e.id)).toBe(1);

    // An id that never existed.
    const unknown = await postAttempt(t.app, e.token, {
      challengeId: new Types.ObjectId().toHexString(),
      selectedIndex: 0,
    });
    expect(unknown.status).toBe(409);

    // A challenge of a closed (passed) run.
    const current = wrong.body.status.challenge.challengeId as string;
    const pass = await answerRight(t.app, e, current);
    expect(pass.status).toBe(201);
    const closed = await postAttempt(t.app, e.token, { challengeId: current, selectedIndex: 0 });
    expect(closed.status).toBe(409);
    expect(await attemptsUsed(e.id)).toBe(2);
  });

  it('GT12: ten concurrent submits for one challenge consume exactly one attempt', async () => {
    const e = await gateEmployee(t.app, creds);
    const { challenge } = await openChallenge(t.app, e.token);
    const key = await keyFor(e.id);
    const wrongIndex = (key + 1) % 4;
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        postAttempt(t.app, e.token, {
          challengeId: challenge?.challengeId,
          selectedIndex: wrongIndex,
        }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);
    expect(await attemptsUsed(e.id)).toBe(1);
    expect(await GateAnswer.countDocuments({})).toBe(1);
  });

  it('GT12b: concurrent challenge requests create exactly one run', async () => {
    const e = await gateEmployee(t.app, creds);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => postChallenge(t.app, e.token)),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.challenge.challengeId)).size).toBe(1);
    expect(await GateRun.countDocuments({ userId: e.id })).toBe(1);
  });

  it('GT12c: a request that saw no run never replaces the live challenge a concurrent request created', async () => {
    // Regression for the CI failure on PR 6 (GT12b returned two challenge ids). The interleaving is
    // forced: request B reads the gate status before any run exists, request A then creates the run
    // with a live challenge, and only then does B look for the open run. B must serve A's challenge
    // instead of replacing it, which would reveal an extra question without consuming an attempt.
    const e = await gateEmployee(t.app, creds);
    const original = GateRun.findOne.bind(GateRun) as (...a: unknown[]) => {
      lean: () => Promise<unknown>;
    };
    let release: () => void = () => undefined;
    const aCreated = new Promise<void>((r) => {
      release = r;
    });
    let openQueries = 0;
    const hold = { parked: false };
    const spy = vi.spyOn(GateRun, 'findOne').mockImplementation(((...args: unknown[]) => {
      const filter = (args[0] ?? {}) as { status?: unknown };
      if (filter.status === 'open') {
        openQueries += 1;
        // B's first open-run query is inside the status read; the second is openChallenge's own
        // lookup, which waits until A has created the run.
        if (openQueries === 2) {
          hold.parked = true;
          return { lean: () => aCreated.then(() => original(...args).lean()) };
        }
      }
      return original(...args);
    }) as never);
    const b = postChallenge(t.app, e.token);
    for (let i = 0; i < 100 && !hold.parked; i += 1) await new Promise((r) => setTimeout(r, 10));
    spy.mockRestore();
    expect(hold.parked).toBe(true);
    const a = await postChallenge(t.app, e.token);
    release();
    const bRes = await b;
    expect(a.status).toBe(200);
    expect(bRes.status).toBe(200);
    expect(bRes.body.challenge.challengeId).toBe(a.body.challenge.challengeId);
    const run = await GateRun.findOne({ userId: new Types.ObjectId(e.id) }).lean();
    expect(run?.servedQuestionIds).toHaveLength(1);
    expect(run?.attemptsUsed).toBe(0);
  });

  it("GT13: another employee's challenge id is a 409 that changes and reveals nothing", async () => {
    const a = await gateEmployee(t.app, creds);
    const b = await gateEmployee(t.app, creds);
    const { challenge } = await openChallenge(t.app, a.token);
    await openChallenge(t.app, b.token);
    const res = await postAttempt(t.app, b.token, {
      challengeId: challenge?.challengeId,
      selectedIndex: await keyFor(a.id),
    });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).not.toContain('Reason');
    expect(await attemptsUsed(a.id)).toBe(0);
    expect(await attemptsUsed(b.id)).toBe(0);
    expect((await getStatus(t.app, a.token)).body.challenge.challengeId).toBe(
      challenge?.challengeId,
    );
  });

  it('GT14: attempts cannot be reset by a new session, a new login or a restart', async () => {
    const e = await gateEmployee(t.app, creds);
    let status = await openChallenge(t.app, e.token);
    for (let i = 0; i < 2; i += 1) {
      const res = await answerWrong(t.app, e, status.challenge?.challengeId ?? '');
      status = res.body.status;
    }
    expect(status.attemptsRemaining).toBe(1);

    const login = await loginOk(t.app, e);
    expect((await getStatus(t.app, login.accessToken)).body.attemptsRemaining).toBe(1);
    expect((await postChallenge(t.app, login.accessToken)).body.attemptsRemaining).toBe(1);

    const restarted = await buildGateApp();
    const again = await loginOk(restarted.app, e);
    const after = await getStatus(restarted.app, again.accessToken);
    expect(after.body.attemptsRemaining).toBe(1);
    expect(after.body.challenge.challengeId).toBe(status.challenge?.challengeId);
    expect(await GateRun.countDocuments({ userId: e.id })).toBe(1);
  });

  it('GT15: twenty failed logins leave the gate state unchanged (no lever against a colleague)', async () => {
    const e = await gateEmployee(t.app, creds);
    await openChallenge(t.app, e.token);
    const before = await GateRun.findOne({ userId: e.id }).lean();
    for (let i = 0; i < 20; i += 1) {
      const res = await request(t.app)
        .post('/api/v1/auth/login')
        .send({ email: e.email, password: 'definitely-not-the-password' });
      expect(res.status).toBe(401);
    }
    const after = await GateRun.findOne({ userId: e.id }).lean();
    expect(after).toEqual(before);
    expect(await GateRun.countDocuments({})).toBe(1);
    expect((await getStatus(t.app, e.token)).body.attemptsRemaining).toBe(3);
  });

  it('GT16: no response carries a key field, and no explanation appears before an answer', async () => {
    const e = await gateEmployee(t.app, creds);
    const bodies: unknown[] = [];
    bodies.push((await getStatus(t.app, e.token)).body);
    const challenge = await postChallenge(t.app, e.token);
    bodies.push(challenge.body);
    bodies.push((await getStatus(t.app, e.token)).body);
    const wrong = await answerWrong(t.app, e, challenge.body.challenge.challengeId);
    bodies.push(wrong.body);
    const right = await answerRight(t.app, e, wrong.body.status.challenge.challengeId);
    bodies.push(right.body);
    bodies.push((await getStatus(t.app, e.token)).body);

    for (const body of bodies) {
      const keys = allKeys(body);
      for (const forbidden of ['correctAnswer', 'correctIndex', 'isCorrect', 'key', 'answer']) {
        expect(keys.has(forbidden), forbidden).toBe(false);
      }
    }
    // Before an answer there is nothing to learn from: no explanation anywhere.
    for (const body of bodies.slice(0, 3)) expect(allKeys(body).has('explanation')).toBe(false);
    expect(JSON.stringify(bodies.slice(0, 3))).not.toMatch(/Reason \d+/);
    // The run document never serialises its key snapshot.
    const open = await gateEmployee(t.app, creds);
    await openChallenge(t.app, open.token);
    const run = await GateRun.findOne({ userId: open.id }).select('+current.correctAnswer');
    expect(typeof run?.current?.correctAnswer).toBe('number');
    expect(JSON.stringify(run?.toJSON())).not.toContain('correctAnswer');
  });
});
