import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { audit } from '../src/features/audit/audit.service.js';
import { restoreAccessSchema } from '@csense/shared';
import { AuditLog, Escalation, GateRun } from '../src/models/index.js';
import { bearer, makeCredentials } from './helpers/fixtures.js';
import {
  buildGateApp,
  createGateQuestions,
  escalationFor,
  failGate,
  gateAdmin,
  gateEmployee,
  gateFlag,
  getStatus,
  openChallenge,
  type GateApp,
  type GateEmployee,
} from './helpers/gateFixtures.js';
import { syncLearningIndexes } from './helpers/learningFixtures.js';
import { auditEntriesFor, verifyAuditChain } from './helpers/riskFixtures.js';
import request from 'supertest';

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

const NOTE = 'Spoke to the employee and their manager; SECRET-RESTORE-NOTE.';
const restore = (admin: GateEmployee, userId: string, body: unknown = { note: NOTE }) =>
  request(t.app)
    .post(`/api/v1/admin/users/${userId}/restore-access`)
    .set(...bearer(admin.token))
    .send(body as object);

const acknowledge = (admin: GateEmployee, escalationId: string) =>
  request(t.app)
    .patch(`/api/v1/admin/escalations/${escalationId}`)
    .set(...bearer(admin.token))
    .send({ action: 'acknowledge', expectedVersion: 0 });

async function restrictedEmployee() {
  const e = await gateEmployee(t.app, creds);
  await failGate(t.app, e);
  const esc = await escalationFor(e.id);
  return { e, escalationId: esc?._id.toHexString() ?? '' };
}

describe('restore access', () => {
  it('GT17: restoring while the escalation is still open is refused and changes nothing', async () => {
    const { e } = await restrictedEmployee();
    const admin = await gateAdmin(t.app, creds);
    const res = await restore(admin, e.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ESCALATION_NOT_ACKNOWLEDGED');
    expect((await getStatus(t.app, e.token)).body.state).toBe('restricted');
    expect(await gateFlag(e.id)).not.toBeNull();
    expect((await GateRun.findOne({ userId: e.id }).lean())?.restoredAt).toBeNull();
  });

  it('GT17b: with GATE_RESTORE_REQUIRES_ACK=false an open escalation does not block the restore', async () => {
    t = await buildGateApp({ gate: { restoreRequiresAck: false } });
    const { e } = await restrictedEmployee();
    const admin = await gateAdmin(t.app, creds);
    expect((await restore(admin, e.id)).status).toBe(200);
  });

  it('GT18: after the acknowledgement the restore works, is audited with the note hash only, and gives fresh attempts', async () => {
    const { e, escalationId } = await restrictedEmployee();
    const admin = await gateAdmin(t.app, creds);
    expect((await acknowledge(admin, escalationId)).status).toBe(200);

    const res = await restore(admin, e.id);
    expect(res.status).toBe(200);
    const dto = restoreAccessSchema.parse(res.body);
    expect(dto).toMatchObject({ userId: e.id, escalationId });
    const run = await GateRun.findOne({ userId: e.id }).lean();
    expect(dto.runId).toBe(run?._id.toHexString());
    expect(run).toMatchObject({ status: 'restricted' });
    expect(run?.restoredAt).toEqual(new Date(dto.restoredAt));
    expect(run?.restoredBy?.toHexString()).toBe(admin.id);
    expect(await gateFlag(e.id)).toBeNull();

    const entries = await AuditLog.find({ action: 'gate.access_restored' }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ severity: 'warning', outcome: 'success' });
    expect(entries[0]?.metadata).toEqual({
      runId: dto.runId,
      escalationId,
      noteSha256: createHash('sha256').update(NOTE).digest('hex'),
      noteLength: NOTE.length,
    });
    expect(entries[0]?.targetId?.toHexString()).toBe(e.id);
    expect(entries[0]?.actorId?.toHexString()).toBe(admin.id);

    // The note text lives on the escalation only; no audit entry carries it.
    const everything = JSON.stringify(await AuditLog.find({}).lean());
    expect(everything).not.toContain('SECRET-RESTORE-NOTE');
    const esc = await Escalation.findById(escalationId).lean();
    expect(esc?.events.some((ev) => ev.type === 'note' && ev.note === NOTE && ev.audited)).toBe(
      true,
    );
    const onEsc = await auditEntriesFor(escalationId);
    expect(onEsc.map((a) => a.action)).toEqual([
      'escalation.opened',
      'escalation.acknowledged',
      'escalation.note_added',
    ]);

    // Restoring never resolves the escalation.
    expect(esc?.status).toBe('acknowledged');
    expect(esc?.active).toBe(true);

    // Access is back, and the next challenge opens a fresh run with full attempts.
    expect(
      (
        await request(t.app)
          .get('/api/v1/modules')
          .set(...bearer(e.token))
      ).status,
    ).toBe(200);
    const status = await openChallenge(t.app, e.token);
    expect(status.state).toBe('challenge');
    expect(status.attemptsRemaining).toBe(3);
    expect(await GateRun.countDocuments({ userId: e.id })).toBe(2);
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it('GT18b: a repeat restore and a concurrent double restore give exactly one success', async () => {
    const { e, escalationId } = await restrictedEmployee();
    const admin = await gateAdmin(t.app, creds);
    await acknowledge(admin, escalationId);
    const results = await Promise.all([
      restore(admin, e.id),
      restore(admin, e.id),
      restore(admin, e.id),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(await AuditLog.countDocuments({ action: 'gate.access_restored' })).toBe(1);
    expect((await restore(admin, e.id)).body.error.code).toBe('NOT_RESTRICTED');
  });

  it('GT18c: a second failure after a restore opens a new run and a new escalation', async () => {
    const { e, escalationId } = await restrictedEmployee();
    const admin = await gateAdmin(t.app, creds);
    await acknowledge(admin, escalationId);
    expect((await restore(admin, e.id)).status).toBe(200);
    await failGate(t.app, e);
    expect(
      await Escalation.countDocuments({ userId: e.id, reason: 'gate_access_restricted' }),
    ).toBe(2);
    const all = await Escalation.find({ userId: e.id, reason: 'gate_access_restricted' }).lean();
    const second = all.find((x) => x._id.toHexString() !== escalationId);
    expect(second?.status).toBe('open');
    // The restored first run does not count as the live restriction; the new one does.
    expect((await restore(admin, e.id)).body.error.code).toBe('ESCALATION_NOT_ACKNOWLEDGED');
    expect((await getStatus(t.app, e.token)).body.state).toBe('restricted');
  });

  it('GT19: guard rails: not restricted, unknown or non-employee target, wrong role, bad notes', async () => {
    const admin = await gateAdmin(t.app, creds);
    const calm = await gateEmployee(t.app, creds);
    const notRestricted = await restore(admin, calm.id);
    expect(notRestricted.status).toBe(409);
    expect(notRestricted.body.error.code).toBe('NOT_RESTRICTED');

    expect((await restore(admin, new Types.ObjectId().toHexString())).status).toBe(404);
    const other = await gateAdmin(t.app, creds);
    expect((await restore(admin, other.id)).status).toBe(404);

    const { e, escalationId } = await restrictedEmployee();
    await acknowledge(admin, escalationId);
    // An employee cannot restore anybody, including themselves.
    const asEmployee = await restore(e, e.id);
    expect(asEmployee.status).toBe(403);
    expect(asEmployee.body.error.code).toBe('FORBIDDEN');
    const peer = await gateEmployee(t.app, creds);
    const peerRes = await restore(peer, e.id);
    expect(peerRes.status).toBe(403);
    expect(peerRes.body.error.code).toBe('FORBIDDEN');

    for (const body of [
      {},
      { note: '' },
      { note: '   ' },
      { note: 'x'.repeat(2001) },
      { note: 'bell\u0007char' },
      { note: 'lone\ud800surrogate' },
      { note: 'fine', extra: true },
      { note: 5 },
    ]) {
      const res = await restore(admin, e.id, body);
      expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect((await restore(admin, 'not-an-id')).status).toBe(400);
    // Nothing above restored anyone.
    expect((await getStatus(t.app, e.token)).body.state).toBe('restricted');
    expect(await AuditLog.countDocuments({ action: 'gate.access_restored' })).toBe(0);
  });

  it('GT19b: if the restore cannot be audited it is rolled back and access stays restricted', async () => {
    const { e, escalationId } = await restrictedEmployee();
    const admin = await gateAdmin(t.app, creds);
    await acknowledge(admin, escalationId);
    const real = audit.record.bind(audit);
    const spy = vi
      .spyOn(audit, 'record')
      .mockImplementation((input) =>
        input.action === 'gate.access_restored'
          ? Promise.reject(new Error('audit store down'))
          : real(input),
      );
    try {
      const res = await restore(admin, e.id);
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('audit store down');
    } finally {
      spy.mockRestore();
    }
    expect((await GateRun.findOne({ userId: e.id }).lean())?.restoredAt).toBeNull();
    expect(await gateFlag(e.id)).not.toBeNull();
    expect((await getStatus(t.app, e.token)).body.state).toBe('restricted');
    // The failure left no half-restored state: a later restore works.
    expect((await restore(admin, e.id)).status).toBe(200);
  });
});
