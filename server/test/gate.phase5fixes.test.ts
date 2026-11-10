import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { gateOfflineReleaseRequestSchema, gateOfflineReleaseResultSchema } from '@csense/shared';
import { audit } from '../src/features/audit/audit.service.js';
import { AuditLog, Escalation, GateQuestion, GateRun } from '../src/models/index.js';
import { bearer, loginOk, makeCredentials } from './helpers/fixtures.js';
import {
  buildGateApp,
  createGateQuestions,
  escalationFor,
  failGate,
  gateAdmin,
  gateEmployee,
  getStatus,
  keyFor,
  openChallenge,
  postAttempt,
  postChallenge,
  type GateApp,
  type GateEmployee,
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

const report = (token: string, body: unknown) =>
  request(t.app)
    .post('/api/v1/gate/offline-releases')
    .set(...bearer(token))
    .send(body as object);

const minutesAgo = (m: number): string => new Date(t.clock().getTime() - m * 60_000).toISOString();

describe('offline-release reports (P5-M1)', () => {
  it('OR1: stores a warning audit entry, and a replay of the same instant is idempotent', async () => {
    const e = await gateEmployee(t.app, creds);
    const body = { releasedAt: minutesAgo(5), reason: 'api_unreachable', durationSeconds: 120 };
    expect(gateOfflineReleaseRequestSchema.safeParse(body).success).toBe(true);
    const first = await report(e.token, body);
    expect(first.status).toBe(201);
    expect(gateOfflineReleaseResultSchema.parse(first.body)).toEqual({
      recorded: true,
      duplicate: false,
      escalated: false,
    });
    const again = await report(e.token, body);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ duplicate: true });
    const entries = await AuditLog.find({ action: 'gate.offline_release' }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ severity: 'warning', outcome: 'success' });
    expect(entries[0]?.actorId?.toHexString()).toBe(e.id);
    expect(entries[0]?.targetId?.toHexString()).toBe(e.id);
    expect(entries[0]?.metadata).toMatchObject({ reason: 'api_unreachable', restricted: false });
    // A different instant is a different report.
    expect((await report(e.token, { ...body, releasedAt: minutesAgo(9) })).status).toBe(201);
    expect(await AuditLog.countDocuments({ action: 'gate.offline_release' })).toBe(2);
    expect(await Escalation.countDocuments({})).toBe(0);
  });

  it('OR2: the time window and the shape are enforced', async () => {
    t = await buildGateApp({ rateLimit: { gateReportMax: 100 } });
    const e = await gateEmployee(t.app, creds);
    const future = new Date(t.clock().getTime() + 10 * 60_000).toISOString();
    const old = new Date(t.clock().getTime() - 31 * 86_400_000).toISOString();
    const nearLimit = new Date(t.clock().getTime() - 29 * 86_400_000).toISOString();
    const skewed = new Date(t.clock().getTime() + 60_000).toISOString();
    expect((await report(e.token, { releasedAt: future, reason: 'api_unreachable' })).status).toBe(
      400,
    );
    expect((await report(e.token, { releasedAt: old, reason: 'api_unreachable' })).status).toBe(
      400,
    );
    expect(
      (await report(e.token, { releasedAt: nearLimit, reason: 'api_unreachable' })).status,
    ).toBe(201);
    expect((await report(e.token, { releasedAt: skewed, reason: 'api_unreachable' })).status).toBe(
      201,
    );
    const ok = { releasedAt: minutesAgo(1), reason: 'api_unreachable' };
    for (const bad of [
      {},
      { ...ok, reason: 'other' },
      { ...ok, releasedAt: 'yesterday' },
      { ...ok, releasedAt: 12345 },
      { ...ok, durationSeconds: -1 },
      { ...ok, durationSeconds: 1.5 },
      { ...ok, userId: e.id },
      { ...ok, restricted: false },
    ]) {
      expect((await report(e.token, bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('OR3: employees only, with a token', async () => {
    const admin = await gateAdmin(t.app, creds);
    const ok = { releasedAt: minutesAgo(1), reason: 'api_unreachable' };
    expect((await report(admin.token, ok)).status).toBe(403);
    const none = await request(t.app).post('/api/v1/gate/offline-releases').send(ok);
    expect(none.status).toBe(401);
  });

  it('OR4: a restricted employee can report, and the security team is told on the restriction escalation', async () => {
    const e = await gateEmployee(t.app, creds);
    await failGate(t.app, e);
    const esc = await escalationFor(e.id);
    const before = (await Escalation.findById(esc?._id).lean())?.events.length ?? 0;
    const body = { releasedAt: minutesAgo(2), reason: 'api_unreachable', durationSeconds: 300 };
    const res = await report(e.token, body);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ recorded: true, duplicate: false, escalated: true });

    const after = await Escalation.findById(esc?._id).lean();
    expect(after?.events.length).toBe(before + 1);
    expect(after?.events.at(-1)?.type).toBe('retriggered');
    expect(after?.status).toBe('open');
    expect(t.notifier.escalationRetriggered).toHaveBeenCalledTimes(1);
    expect(await Escalation.countDocuments({ userId: e.id })).toBe(1);
    const entry = await AuditLog.findOne({ action: 'gate.offline_release' }).lean();
    expect(entry?.metadata).toMatchObject({ restricted: true });

    // A replay changes nothing and does not notify again.
    const replay = await report(e.token, body);
    expect(replay.status).toBe(200);
    expect((await Escalation.findById(esc?._id).lean())?.events.length).toBe(before + 1);
    expect(t.notifier.escalationRetriggered).toHaveBeenCalledTimes(1);
    expect(await AuditLog.countDocuments({ action: 'gate.offline_release' })).toBe(1);
  });

  it('OR5: reports are rate limited per employee, not per address', async () => {
    const limited = await buildGateApp({ rateLimit: { gateReportMax: 2 } });
    const a = await gateEmployee(limited.app, creds);
    const b = await gateEmployee(limited.app, creds);
    const send = (token: string, minutes: number) =>
      request(limited.app)
        .post('/api/v1/gate/offline-releases')
        .set(...bearer(token))
        .send({
          releasedAt: new Date(limited.clock().getTime() - minutes * 60_000).toISOString(),
          reason: 'api_unreachable',
        });
    expect((await send(a.token, 1)).status).toBe(201);
    expect((await send(a.token, 2)).status).toBe(201);
    const third = await send(a.token, 3);
    expect(third.status).toBe(429);
    expect(third.headers['retry-after']).toBeTruthy();
    // Another employee from the same address still has their own budget.
    expect((await send(b.token, 1)).status).toBe(201);
  });
});

describe('challenge TTL (P5-I4)', () => {
  it('CT1: an expired challenge is stale (409), consumes nothing, and a new one is issued on request', async () => {
    const e = await gateEmployee(t.app, creds);
    const first = (await openChallenge(t.app, e.token)).challenge;
    t.advance(9 * 60_000);
    // Still valid at 9 minutes.
    const fresh = await loginOk(t.app, e);
    expect((await getStatus(t.app, fresh.accessToken)).body.state).toBe('challenge');

    t.advance(2 * 60_000); // 11 minutes in
    const token = (await loginOk(t.app, e)).accessToken;
    const late = await postAttempt(t.app, token, {
      challengeId: first?.challengeId,
      selectedIndex: await keyFor(e.id),
    });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('GATE_CHALLENGE_STALE');
    const run = await GateRun.findOne({ userId: e.id }).lean();
    expect(run?.attemptsUsed).toBe(0);
    expect(run?.status).toBe('open');

    // The read says a challenge is required; asking for one replaces the expired one.
    const status = await getStatus(t.app, token);
    expect(status.body).toMatchObject({ state: 'required', attemptsRemaining: 3, challenge: null });
    const replaced = (await postChallenge(t.app, token)).body;
    expect(replaced.state).toBe('challenge');
    expect(replaced.attemptsRemaining).toBe(3);
    expect(replaced.challenge.challengeId).not.toBe(first?.challengeId);
    const ok = await postAttempt(t.app, token, {
      challengeId: replaced.challenge.challengeId,
      selectedIndex: await keyFor(e.id),
    });
    expect(ok.status).toBe(201);
    expect(ok.body.correct).toBe(true);
    expect(await GateRun.countDocuments({ userId: e.id })).toBe(1);
  });

  it('CT2: refreshing an expired challenge does not reset the attempts already used', async () => {
    const e = await gateEmployee(t.app, creds);
    const c1 = (await openChallenge(t.app, e.token)).challenge;
    const wrong = await postAttempt(t.app, e.token, {
      challengeId: c1?.challengeId,
      selectedIndex: ((await keyFor(e.id)) + 1) % 4,
    });
    expect(wrong.body.status.attemptsRemaining).toBe(2);
    t.advance(15 * 60_000);
    const token = (await loginOk(t.app, e)).accessToken;
    const replaced = (await postChallenge(t.app, token)).body;
    expect(replaced.attemptsRemaining).toBe(2);
    expect(await GateRun.countDocuments({ userId: e.id })).toBe(1);
  });

  it('CT3: GATE_CHALLENGE_TTL is configurable', async () => {
    const short = await buildGateApp({ gate: { challengeTtlSeconds: 60 } });
    const e = await gateEmployee(short.app, creds);
    const c = (await openChallenge(short.app, e.token)).challenge;
    short.advance(61_000);
    const token = (await loginOk(short.app, e)).accessToken;
    const res = await postAttempt(short.app, token, {
      challengeId: c?.challengeId,
      selectedIndex: 0,
    });
    expect(res.status).toBe(409);
  });
});

describe('grading always persists (P5-M2)', () => {
  it('GP1: a wrong answer with no next question is graded and consumed; the next challenge request is the 503', async () => {
    const e = await gateEmployee(t.app, creds);
    const c = (await openChallenge(t.app, e.token)).challenge;
    const key = await keyFor(e.id);
    await GateQuestion.updateMany({}, { $set: { isActive: false } });
    const res = await postAttempt(t.app, e.token, {
      challengeId: c?.challengeId,
      selectedIndex: (key + 1) % 4,
    });
    expect(res.status).toBe(201);
    expect(res.body.correct).toBe(false);
    expect(res.body.status).toMatchObject({
      state: 'required',
      attemptsRemaining: 2,
      challenge: null,
    });
    const run = await GateRun.findOne({ userId: e.id }).lean();
    expect(run).toMatchObject({ attemptsUsed: 1, firstAnswerCorrect: false, current: null });

    expect((await postChallenge(t.app, e.token)).status).toBe(503);
    expect((await getStatus(t.app, e.token)).body).toMatchObject({
      state: 'required',
      attemptsRemaining: 2,
    });
    // The old challenge cannot be replayed to probe the key.
    expect(
      (await postAttempt(t.app, e.token, { challengeId: c?.challengeId, selectedIndex: key }))
        .status,
    ).toBe(409);

    // Content comes back: the run continues with the attempts it had left.
    await GateQuestion.updateMany({}, { $set: { isActive: true } });
    const next = (await postChallenge(t.app, e.token)).body;
    expect(next.state).toBe('challenge');
    expect(next.attemptsRemaining).toBe(2);
    expect(next.challenge.challengeId).not.toBe(c?.challengeId);
    expect(await GateRun.countDocuments({ userId: e.id })).toBe(1);
  });
});

describe('restore ordering (P5-L4)', () => {
  it('RO1: a rolled-back restore leaves a "rolled back" note and no admin note text', async () => {
    const e: GateEmployee = await gateEmployee(t.app, creds);
    await failGate(t.app, e);
    const esc = await escalationFor(e.id);
    const admin = await gateAdmin(t.app, creds);
    await request(t.app)
      .patch(`/api/v1/admin/escalations/${esc?._id.toHexString() ?? ''}`)
      .set(...bearer(admin.token))
      .send({ action: 'acknowledge', expectedVersion: 0 });
    const real = audit.record.bind(audit);
    const spy = vi
      .spyOn(audit, 'record')
      .mockImplementation((input) =>
        input.action === 'gate.access_restored' ? Promise.reject(new Error('down')) : real(input),
      );
    const res = await request(t.app)
      .post(`/api/v1/admin/users/${e.id}/restore-access`)
      .set(...bearer(admin.token))
      .send({ note: 'SECRET-ADMIN-NOTE' });
    spy.mockRestore();
    expect(res.status).toBe(500);
    const notes = (await Escalation.findById(esc?._id).lean())?.events.filter(
      (ev) => ev.type === 'note',
    );
    expect(notes).toHaveLength(1);
    expect(notes?.[0]?.note).toMatch(/rolled back/i);
    expect(JSON.stringify(notes)).not.toContain('SECRET-ADMIN-NOTE');
  });
});
