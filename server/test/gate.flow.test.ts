import { Types } from 'mongoose';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Employee, GateAnswer, GateRun } from '../src/models/index.js';
import { loginOk, makeCredentials } from './helpers/fixtures.js';
import {
  HOUR_MS,
  answerRight,
  answerWrong,
  buildGateApp,
  createGateQuestions,
  gateAdmin,
  gateEmployee,
  getStatus,
  openChallenge,
  parseResult,
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

describe('gate flow', () => {
  it('GT1: status is required, a challenge starts a run with 3 of 3, and asking again returns the same challenge', async () => {
    const e = await gateEmployee(t.app, creds);
    const status = await getStatus(t.app, e.token);
    expect(status.status).toBe(200);
    expect(status.body).toEqual({
      state: 'required',
      maxAttempts: 3,
      attemptsRemaining: 3,
      challenge: null,
      clearedUntil: null,
      restricted: null,
    });
    // A pure read creates nothing.
    expect(await GateRun.countDocuments({})).toBe(0);

    const first = await openChallenge(t.app, e.token);
    expect(first.state).toBe('challenge');
    expect(first.attemptsRemaining).toBe(3);
    expect(first.challenge?.options).toHaveLength(4);
    const again = await openChallenge(t.app, e.token);
    expect(again.challenge?.challengeId).toBe(first.challenge?.challengeId);
    expect(again.challenge?.prompt).toBe(first.challenge?.prompt);
    expect(await GateRun.countDocuments({ status: 'open' })).toBe(1);

    // The read returns the same open challenge.
    const read = await getStatus(t.app, e.token);
    expect(read.body.challenge.challengeId).toBe(first.challenge?.challengeId);
  });

  it('GT2: a correct answer grants access for the clearance TTL, with the explanation and 10 XP; a second pass the same day earns 0', async () => {
    const e = await gateEmployee(t.app, creds);
    const status = await openChallenge(t.app, e.token);
    const res = await answerRight(t.app, e, status.challenge?.challengeId ?? '');
    expect(res.status).toBe(201);
    const result = parseResult(res.body);
    expect(result.correct).toBe(true);
    expect(result.explanation).toMatch(/^Reason \d+:/);
    expect(result.xpEarned).toBe(10);
    expect(result.status.state).toBe('granted');
    expect(result.status.clearedUntil).toBe(
      new Date(t.clock().getTime() + 12 * HOUR_MS).toISOString(),
    );
    expect((await Employee.findById(e.id).lean())?.totalXP).toBe(10);

    // While cleared a challenge opens nothing.
    const granted = await postChallenge(t.app, e.token);
    expect(granted.body.state).toBe('granted');
    expect(await GateRun.countDocuments({ status: 'open' })).toBe(0);

    // 12h01m later (still the same UTC day) the clearance has expired and a new run passes for 0 XP.
    t.advance(12 * HOUR_MS + 60_000);
    const e2 = { ...e, token: (await gateEmployeeLogin(e)).token };
    const second = await openChallenge(t.app, e2.token);
    const res2 = await answerRight(t.app, e2, second.challenge?.challengeId ?? '');
    expect(parseResult(res2.body).xpEarned).toBe(0);
    expect((await Employee.findById(e.id).lean())?.totalXP).toBe(10);
  });

  it('GT3: a wrong answer shows the explanation, 2 remaining, a new challenge id and a different question', async () => {
    const e = await gateEmployee(t.app, creds);
    const first = await openChallenge(t.app, e.token);
    const res = await answerWrong(t.app, e, first.challenge?.challengeId ?? '');
    expect(res.status).toBe(201);
    const result = parseResult(res.body);
    expect(result.correct).toBe(false);
    expect(result.explanation.length).toBeGreaterThan(0);
    expect(result.xpEarned).toBe(0);
    expect(result.status.state).toBe('challenge');
    expect(result.status.attemptsRemaining).toBe(2);
    expect(result.status.challenge?.challengeId).not.toBe(first.challenge?.challengeId);
    expect(result.status.challenge?.prompt).not.toBe(first.challenge?.prompt);

    // Each of the three attempts served a different question.
    const second = result.status;
    const res2 = await answerWrong(t.app, e, second.challenge?.challengeId ?? '');
    const third = parseResult(res2.body).status;
    const prompts = new Set([
      first.challenge?.prompt,
      second.challenge?.prompt,
      third.challenge?.prompt,
    ]);
    expect(prompts.size).toBe(3);
    expect(await GateAnswer.countDocuments({})).toBe(2);
  });

  it('GT4: after the clearance expires the status is required again', async () => {
    const e = await gateEmployee(t.app, creds);
    const status = await openChallenge(t.app, e.token);
    await answerRight(t.app, e, status.challenge?.challengeId ?? '');
    expect((await getStatus(t.app, e.token)).body.state).toBe('granted');

    t.advance(11 * HOUR_MS);
    const mid = await gateEmployeeLogin(e);
    expect((await getStatus(t.app, mid.token)).body.state).toBe('granted');

    t.advance(2 * HOUR_MS);
    const later = await gateEmployeeLogin(e);
    expect((await getStatus(t.app, later.token)).body.state).toBe('required');
  });

  it('GT5: an administrator gets 403 on every gate route', async () => {
    const admin = await gateAdmin(t.app, creds);
    expect((await getStatus(t.app, admin.token)).status).toBe(403);
    expect((await postChallenge(t.app, admin.token)).status).toBe(403);
    const attempt = await postAttempt(t.app, admin.token, {
      challengeId: new Types.ObjectId().toHexString(),
      selectedIndex: 0,
    });
    expect(attempt.status).toBe(403);
    expect(attempt.body.error.code).toBe('FORBIDDEN');
  });

  it('GT5b: the routes need a token', async () => {
    for (const [method, path] of [
      ['get', '/gate/status'],
      ['post', '/gate/challenge'],
      ['post', '/gate/attempts'],
    ] as const) {
      const res = await request(t.app)[method](`/api/v1${path}`).send({});
      expect(res.status, path).toBe(401);
    }
  });

  it('GT5c: the correct option is shuffled per challenge, the key refers to the served order', async () => {
    // A reversing shuffle: the served order is the reverse of the stored one.
    const reverse = await buildGateApp(
      {},
      { shuffle: <T>(items: readonly T[]): T[] => [...items].reverse() },
    );
    const e = await gateEmployee(reverse.app, creds);
    const status = await openChallenge(reverse.app, e.token);
    expect(status.challenge?.options).toEqual(['Option D', 'Option C', 'Option B', 'Option A']);
    const res = await answerRight(reverse.app, e, status.challenge?.challengeId ?? '');
    expect(parseResult(res.body).correct).toBe(true);
  });

  it('GT5d: the run stays open across sessions: a second login sees the same challenge and attempts', async () => {
    const e = await gateEmployee(t.app, creds);
    const first = await openChallenge(t.app, e.token);
    await answerWrong(t.app, e, first.challenge?.challengeId ?? '');
    const other = await gateEmployeeLogin(e);
    const status = await getStatus(t.app, other.token);
    expect(status.body.state).toBe('challenge');
    expect(status.body.attemptsRemaining).toBe(2);
  });
});

async function gateEmployeeLogin(e: { email: string; password: string; id: string }) {
  const body = await loginOk(t.app, e);
  return { ...e, token: body.accessToken };
}
