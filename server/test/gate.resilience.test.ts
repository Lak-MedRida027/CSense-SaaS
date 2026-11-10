import { Types } from 'mongoose';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuditLog,
  Employee,
  Escalation,
  GateQuestion,
  GateRun,
  ReconcileMarker,
} from '../src/models/index.js';
import { bearer, loginOk, makeCredentials } from './helpers/fixtures.js';
import {
  HOUR_MS,
  buildGateApp,
  createGateQuestions,
  escalationFor,
  failGate,
  gateAdmin,
  gateEmployee,
  gateFlag,
  getStatus,
  passGate,
  postChallenge,
  type GateApp,
} from './helpers/gateFixtures.js';
import { syncLearningIndexes } from './helpers/learningFixtures.js';
import { auditEntriesFor, verifyAuditChain } from './helpers/riskFixtures.js';

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

const markerReasons = async (userId: string): Promise<string[]> =>
  (await ReconcileMarker.findOne({ userId: new Types.ObjectId(userId) }).lean())?.reasons ?? [];

describe('gate resilience', () => {
  it('GT20: an escalation failure on restrict still answers 201 restricted, leaves a marker, and reconcile opens exactly one escalation', async () => {
    const e = await gateEmployee(t.app, creds);
    const spy = vi
      .spyOn(t.g.escalations, 'recordCriticalEvent')
      .mockRejectedValueOnce(new Error('escalation store down'));
    const result = await failGate(t.app, e);
    spy.mockRestore();

    expect(result.status.state).toBe('restricted');
    expect(await escalationFor(e.id)).toBeNull();
    expect(await markerReasons(e.id)).toContain('gate');
    // The flag was set before the failing step, so access is already blocked.
    expect(await gateFlag(e.id)).not.toBeNull();
    expect(
      (
        await request(t.app)
          .get('/api/v1/modules')
          .set(...bearer(e.token))
      ).body.error.code,
    ).toBe('ACCESS_RESTRICTED');

    const diff = await t.g.reconcile.reconcileUser(e.id);
    expect(diff.escalationRepaired).toBe(true);
    const escalations = await Escalation.find({ userId: e.id }).lean();
    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toMatchObject({
      reason: 'gate_access_restricted',
      severity: 'critical',
    });
    const run = await GateRun.findOne({ userId: e.id }).lean();
    expect(run?.escalationId?.toHexString()).toBe(escalations[0]?._id.toHexString());
    expect(
      (await auditEntriesFor(e.id)).filter(
        (a) => a.action === 'governance.critical_event_recorded',
      ),
    ).toHaveLength(1);
    expect(
      (await auditEntriesFor(escalations[0]?._id.toHexString() ?? '')).map((a) => a.action),
    ).toEqual(['escalation.opened']);

    // Repeating the repair changes nothing.
    const again = await t.g.reconcile.reconcileUser(e.id);
    expect(again.escalationRepaired).toBe(false);
    expect(await Escalation.countDocuments({ userId: e.id })).toBe(1);
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it('GT20b: the sweeper repairs a restriction that left no marker at all', async () => {
    const e = await gateEmployee(t.app, creds);
    vi.spyOn(t.g.escalations, 'recordCriticalEvent').mockRejectedValue(new Error('down'));
    const mark = vi.spyOn(t.g.markers, 'mark').mockResolvedValue(undefined);
    await failGate(t.app, e);
    vi.restoreAllMocks();
    expect(mark).toHaveBeenCalled();
    expect(await ReconcileMarker.countDocuments({})).toBe(0);
    expect(await escalationFor(e.id)).toBeNull();

    // Too fresh: a request may still be finishing its own effects.
    await t.g.sweeper.sweepOnce();
    expect(await escalationFor(e.id)).toBeNull();

    t.advance(2 * 60_000);
    const summary = await t.g.sweeper.sweepOnce();
    expect(summary.reconciled).toBeGreaterThanOrEqual(1);
    expect(await Escalation.countDocuments({ userId: e.id })).toBe(1);
    expect((await GateRun.findOne({ userId: e.id }).lean())?.escalationId).not.toBeNull();
  });

  it('GT21: a failed user-flag write is repaired by reconcile', async () => {
    const e = await gateEmployee(t.app, creds);
    const spy = vi
      .spyOn(Employee, 'updateOne')
      .mockRejectedValueOnce(new Error('write failed'))
      .mockRejectedValueOnce(new Error('write failed again'));
    const result = await failGate(t.app, e);
    spy.mockRestore();
    expect(result.status.state).toBe('restricted');
    expect(await gateFlag(e.id)).toBeNull();
    expect(await markerReasons(e.id)).toContain('gate');
    // The record of truth already says restricted, even though the API cache does not yet.
    expect((await getStatus(t.app, e.token)).body.state).toBe('restricted');
    // The escalation did not depend on the flag.
    expect(await escalationFor(e.id)).not.toBeNull();

    await t.g.reconcile.reconcileUser(e.id);
    expect(await gateFlag(e.id)).not.toBeNull();
    expect(
      (
        await request(t.app)
          .get('/api/v1/modules')
          .set(...bearer(e.token))
      ).body.error.code,
    ).toBe('ACCESS_RESTRICTED');
  });

  it('GT22: a stale flag whose run was restored, or no longer exists, is cleared by reconcile', async () => {
    const e = await gateEmployee(t.app, creds);
    await failGate(t.app, e);
    const run = await GateRun.findOne({ userId: e.id }).lean();
    const admin = await gateAdmin(t.app, creds);
    const esc = await escalationFor(e.id);
    await request(t.app)
      .patch(`/api/v1/admin/escalations/${esc?._id.toHexString() ?? ''}`)
      .set(...bearer(admin.token))
      .send({ action: 'acknowledge', expectedVersion: 0 });
    expect(
      (
        await request(t.app)
          .post(`/api/v1/admin/users/${e.id}/restore-access`)
          .set(...bearer(admin.token))
          .send({ note: 'Reviewed.' })
      ).status,
    ).toBe(200);

    // Plant the stale flag of the restored run.
    await Employee.updateOne(
      { _id: new Types.ObjectId(e.id) },
      { $set: { gateRestriction: { restrictedAt: t.clock(), runId: run?._id } } },
    );
    expect(await gateFlag(e.id)).not.toBeNull();
    const dry = await t.g.reconcile.reconcileUser(e.id, { dryRun: true });
    expect(dry.escalationRepaired).toBe(true);
    expect(await gateFlag(e.id)).not.toBeNull(); // a dry run writes nothing
    await t.g.reconcile.reconcileUser(e.id);
    expect(await gateFlag(e.id)).toBeNull();

    // A flag that points at a run that never existed.
    await Employee.updateOne(
      { _id: new Types.ObjectId(e.id) },
      { $set: { gateRestriction: { restrictedAt: t.clock(), runId: new Types.ObjectId() } } },
    );
    await t.g.reconcile.reconcileUser(e.id);
    expect(await gateFlag(e.id)).toBeNull();
    expect(
      (
        await request(t.app)
          .get('/api/v1/modules')
          .set(...bearer(e.token))
      ).status,
    ).toBe(200);
  });

  it('GT22b: a flag that points at an older run is moved to the live restriction', async () => {
    const e = await gateEmployee(t.app, creds);
    await failGate(t.app, e);
    const run = await GateRun.findOne({ userId: e.id }).lean();
    await Employee.updateOne(
      { _id: new Types.ObjectId(e.id) },
      { $set: { gateRestriction: { restrictedAt: t.clock(), runId: new Types.ObjectId() } } },
    );
    await t.g.reconcile.reconcileUser(e.id);
    expect((await gateFlag(e.id))?.runId.toHexString()).toBe(run?._id.toHexString());
  });

  it('GT23: a pool smaller than the attempts gives 503 GATE_UNAVAILABLE and one audit warning per hour', async () => {
    await GateQuestion.updateMany({}, { $set: { isActive: false } });
    await GateQuestion.updateMany({ prompt: /question [01]:/ }, { $set: { isActive: true } });
    expect(await GateQuestion.countDocuments({ isActive: true })).toBe(2);
    const e = await gateEmployee(t.app, creds);

    for (let i = 0; i < 3; i += 1) {
      const res = await postChallenge(t.app, e.token);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('GATE_UNAVAILABLE');
    }
    expect(await GateRun.countDocuments({})).toBe(0);
    const entries = await AuditLog.find({ action: 'gate.content_unavailable' }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ severity: 'warning', outcome: 'failure' });
    expect(entries[0]?.metadata).toEqual({ activeQuestions: 2, required: 3 });

    // The read stays available (state required), and the next hour logs once more.
    expect((await getStatus(t.app, e.token)).body.state).toBe('required');
    t.advance(HOUR_MS + 1000);
    const fresh = (await loginOk(t.app, e)).accessToken;
    expect((await postChallenge(t.app, fresh)).status).toBe(503);
    expect(await AuditLog.countDocuments({ action: 'gate.content_unavailable' })).toBe(2);

    // Exactly maxAttempts active questions is enough, and then no question repeats within the run.
    await GateQuestion.updateMany({ prompt: /question 2:/ }, { $set: { isActive: true } });
    const ok = await postChallenge(t.app, fresh);
    expect(ok.status).toBe(200);
    expect(ok.body.state).toBe('challenge');
  });

  it('GT24: a failed XP and risk hook on a pass leaves a marker, and reconcile restores both', async () => {
    const e = await gateEmployee(t.app, creds);
    const xp = vi.spyOn(t.g.xp, 'recomputeXp').mockRejectedValueOnce(new Error('xp down'));
    const risk = vi
      .spyOn(t.g.risk, 'recomputeForUser')
      .mockRejectedValueOnce(new Error('risk down'));
    const result = await passGate(t.app, e);
    xp.mockRestore();
    risk.mockRestore();
    expect(result.status.state).toBe('granted');
    expect(result.xpEarned).toBe(0);
    expect(await markerReasons(e.id)).toContain('gate');
    expect((await Employee.findById(e.id).lean())?.totalXP).toBe(0);

    await t.g.reconcile.reconcileUser(e.id);
    expect((await Employee.findById(e.id).lean())?.totalXP).toBe(10);
  });
});
