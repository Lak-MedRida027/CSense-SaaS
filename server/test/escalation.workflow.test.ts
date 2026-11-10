import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { escalationDetailSchema, escalationListSchema } from '@csense/shared';
import { audit } from '../src/features/audit/audit.service.js';
import { AuditLog, Escalation, ReconcileMarker } from '../src/models/index.js';
import { createEmployee, makeCredentials } from './helpers/fixtures.js';
import { syncLearningIndexes } from './helpers/learningFixtures.js';
import {
  adminClient,
  buildGamificationApp,
  craftHighRiskEmployee,
  verifyAuditChain,
} from './helpers/riskFixtures.js';

let creds: { password: string; hash: string };

beforeAll(async () => {
  creds = await makeCredentials();
  await syncLearningIndexes();
});

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** EW9: every event of every escalation has exactly one audit entry and is flagged audited. */
async function expectEveryEventAudited(): Promise<void> {
  for (const esc of await Escalation.find({}).lean()) {
    for (const ev of esc.events) {
      const key = `escalation:${esc._id.toHexString()}:event:${ev.eventId.toHexString()}`;
      expect(await AuditLog.countDocuments({ idempotencyKey: key }), key).toBe(1);
      expect(ev.audited, key).toBe(true);
    }
  }
}

const setup = async () => {
  const t = await buildGamificationApp();
  const e = await craftHighRiskEmployee(t.g, creds);
  const admin = await adminClient(t.app, creds);
  return { t, e, admin, path: `/admin/escalations/${e.escalationId}` };
};

describe('escalation workflow (admin)', () => {
  it('EW1: acknowledging assigns the administrator, bumps the version and is audited with the actor', async () => {
    const { e, admin, path } = await setup();
    const res = await admin.patch(path, { action: 'acknowledge', expectedVersion: 0 });
    expect(res.status).toBe(200);
    const dto = escalationDetailSchema.parse(res.body);
    expect(dto).toMatchObject({
      status: 'acknowledged',
      version: 1,
      assignee: { id: admin.id, name: 'Test Admin' },
    });
    expect(dto.events.map((ev) => ev.type)).toEqual(['opened', 'acknowledged']);
    expect(dto.events[1]?.actor).toEqual({
      id: admin.id,
      name: 'Test Admin',
      role: 'administrator',
    });
    const entry = await AuditLog.findOne({ action: 'escalation.acknowledged' }).lean();
    expect(entry).toMatchObject({
      actorRole: 'administrator',
      targetType: 'escalation',
      severity: 'info',
    });
    expect(entry?.actorId?.toHexString()).toBe(admin.id);
    expect(entry?.targetId?.toHexString()).toBe(e.escalationId);
    expect(entry?.metadata).toMatchObject({ from: 'open', to: 'acknowledged' });
  });

  it('EW2: resolving stores the resolution; the audit entry has the note hash and never the note text', async () => {
    const { e, admin, path } = await setup();
    await admin.patch(path, { action: 'acknowledge', expectedVersion: 0 });
    const note = 'Spoke to the line manager; retraining booked for Monday. CONFIDENTIAL-DETAIL';
    const res = await admin.patch(path, {
      action: 'resolve',
      expectedVersion: 1,
      resolution: 'remediated',
      note,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'resolved', resolution: 'remediated', version: 2 });
    const stored = await Escalation.findById(e.escalationId).lean();
    expect(stored?.active).toBe(false);
    expect(stored?.resolvedAt).toBeInstanceOf(Date);
    const entry = await AuditLog.findOne({ action: 'escalation.resolved' }).lean();
    expect(entry?.metadata).toMatchObject({
      resolution: 'remediated',
      noteSha256: sha256(note),
      noteLength: note.length,
    });
    expect(JSON.stringify(await AuditLog.find({}).lean())).not.toContain('CONFIDENTIAL-DETAIL');
    expect(entry?.severity).toBe('info');
  });

  it('EW2b: accepting the risk is audited as a warning', async () => {
    const { t, admin, path } = await setup();
    await admin.patch(path, { action: 'acknowledge', expectedVersion: 0 });
    // Separation of duties: risk_accepted needs a different administrator.
    const second = await adminClient(t.app, creds);
    await second.patch(path, {
      action: 'resolve',
      expectedVersion: 1,
      resolution: 'risk_accepted',
      note: 'Accepted by the CISO',
    });
    expect((await AuditLog.findOne({ action: 'escalation.resolved' }).lean())?.severity).toBe(
      'warning',
    );
  });

  it('EW3: resolving from open and acknowledging twice are 409 INVALID_STATE_TRANSITION', async () => {
    const { admin, path } = await setup();
    const early = await admin.patch(path, {
      action: 'resolve',
      expectedVersion: 0,
      resolution: 'remediated',
      note: 'too early',
    });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect((await admin.patch(path, { action: 'acknowledge', expectedVersion: 0 })).status).toBe(
      200,
    );
    const twice = await admin.patch(path, { action: 'acknowledge', expectedVersion: 1 });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect(await AuditLog.countDocuments({ action: 'escalation.acknowledged' })).toBe(1);
  });

  it('EW4: a stale expectedVersion is a 409 CONFLICT with no state change and no audit', async () => {
    const { e, admin, path } = await setup();
    const before = await AuditLog.countDocuments();
    const res = await admin.patch(path, { action: 'acknowledge', expectedVersion: 5 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    const stored = await Escalation.findById(e.escalationId).lean();
    expect(stored).toMatchObject({ status: 'open', version: 0 });
    expect(stored?.events).toHaveLength(1);
    expect(await AuditLog.countDocuments()).toBe(before);
  });

  it('EW5: two concurrent acknowledgements give one 200, one 409 and one audit entry', async () => {
    const { admin, path } = await setup();
    const body = { action: 'acknowledge', expectedVersion: 0 };
    const results = await Promise.all([admin.patch(path, body), admin.patch(path, body)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await AuditLog.countDocuments({ action: 'escalation.acknowledged' })).toBe(1);
    await expectEveryEventAudited();
  });

  it('EW6: resolving a management-tier escalation needs a management reference', async () => {
    const t = await buildGamificationApp();
    const emp = await createEmployee(creds);
    const { escalationId } = await t.g.escalations.recordCriticalEvent({
      userId: emp.id,
      reason: 'gate_access_restricted',
      sourceRef: { type: 'gate_event', id: new Types.ObjectId().toHexString() },
      occurredAt: new Date(),
    });
    const admin = await adminClient(t.app, creds);
    const path = `/admin/escalations/${escalationId}`;
    expect((await admin.patch(path, { action: 'acknowledge', expectedVersion: 0 })).status).toBe(
      200,
    );
    const resolve = {
      action: 'resolve',
      expectedVersion: 1,
      resolution: 'remediated',
      note: 'Handled',
    };
    // Management tier: a different administrator resolves (separation of duties).
    const admin2 = await adminClient(t.app, creds);
    const missing = await admin2.patch(path, resolve);
    expect(missing.status).toBe(400);
    expect(missing.body.error.details.issues).toEqual([
      expect.objectContaining({ path: 'managementReference' }),
    ]);
    expect((await Escalation.findById(escalationId).lean())?.status).toBe('acknowledged');
    const ok = await admin2.patch(path, { ...resolve, managementReference: 'MGMT-2026-0042' });
    expect(ok.status).toBe(200);
    expect(ok.body.managementReference).toBe('MGMT-2026-0042');
    expect(
      (await AuditLog.findOne({ action: 'escalation.resolved' }).lean())?.metadata,
    ).toMatchObject({
      managementReference: 'MGMT-2026-0042',
    });
  });

  it('EW7: a note on a resolved escalation is accepted and audited without changing the state', async () => {
    const { t, admin, path } = await setup();
    await admin.patch(path, { action: 'acknowledge', expectedVersion: 0 });
    // false_positive is not remediation: a second administrator closes it (P4-L11).
    const second = await adminClient(t.app, creds);
    await second.patch(path, {
      action: 'resolve',
      expectedVersion: 1,
      resolution: 'false_positive',
      note: 'Done',
    });
    const res = await admin.patch(path, { action: 'note', note: 'Follow-up: confirmed with HR' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'resolved', version: 3 });
    expect((res.body.events as unknown[]).at(-1)).toMatchObject({
      type: 'note',
      note: 'Follow-up: confirmed with HR',
    });
    const entry = await AuditLog.findOne({ action: 'escalation.note_added' }).lean();
    expect(entry?.metadata).toMatchObject({ noteSha256: sha256('Follow-up: confirmed with HR') });
    expect(JSON.stringify(entry)).not.toContain('HR');
  });

  it('EW7b: concurrent notes without expectedVersion all succeed', async () => {
    const { e, admin, path } = await setup();
    const results = await Promise.all(
      [1, 2, 3].map((n) => admin.patch(path, { action: 'note', note: `note ${String(n)}` })),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect((await Escalation.findById(e.escalationId).lean())?.events).toHaveLength(4);
    await expectEveryEventAudited();
  });

  it('EW8: an audit failure during PATCH is a 500; the state change stands and the sweeper audits it once', async () => {
    const { t, e, admin, path } = await setup();
    const real = audit.record.bind(audit);
    const spy = vi
      .spyOn(audit, 'record')
      .mockImplementation((input) =>
        input.action === 'escalation.acknowledged'
          ? Promise.reject(new Error('audit down'))
          : real(input),
      );
    let res;
    try {
      res = await admin.patch(path, { action: 'acknowledge', expectedVersion: 0 });
    } finally {
      spy.mockRestore();
    }
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    const stored = await Escalation.findById(e.escalationId).lean();
    expect(stored).toMatchObject({ status: 'acknowledged', version: 1 });
    expect(stored?.events.map((ev) => ev.audited)).toEqual([true, false]);
    expect(await ReconcileMarker.countDocuments({ userId: e.id })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'escalation.acknowledged' })).toBe(0);

    await t.g.sweeper.sweepOnce();
    expect(await AuditLog.countDocuments({ action: 'escalation.acknowledged' })).toBe(1);
    await t.g.sweeper.sweepOnce();
    expect(await AuditLog.countDocuments({ action: 'escalation.acknowledged' })).toBe(1);
    await expectEveryEventAudited();
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it('EW9: the invariant holds after a full workflow', async () => {
    const { admin, path } = await setup();
    await admin.patch(path, { action: 'note', note: 'first look' });
    await admin.patch(path, { action: 'acknowledge', expectedVersion: 1, note: 'taking it' });
    await admin.patch(path, {
      action: 'resolve',
      expectedVersion: 2,
      resolution: 'no_action_required',
      note: 'fine',
    });
    await expectEveryEventAudited();
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it('validation and lookup: unknown id 404, bad id 400, extra or malformed fields 400, list shape', async () => {
    const { admin, path, e } = await setup();
    expect(
      (
        await admin.patch(`/admin/escalations/${new Types.ObjectId().toHexString()}`, {
          action: 'note',
          note: 'x',
        })
      ).status,
    ).toBe(404);
    expect(
      (await admin.get(`/admin/escalations/${new Types.ObjectId().toHexString()}`)).status,
    ).toBe(404);
    expect((await admin.get('/admin/escalations/not-an-id')).status).toBe(400);
    expect(
      (await admin.patch(path, { action: 'acknowledge', expectedVersion: 0, status: 'resolved' }))
        .status,
    ).toBe(400);
    expect((await admin.patch(path, { action: 'note', note: 'x'.repeat(2001) })).status).toBe(400);
    expect((await admin.patch(path, { action: 'explode' })).status).toBe(400);
    expect((await admin.patch(path, { action: 'acknowledge' })).status).toBe(400);
    expect((await Escalation.findById(e.escalationId).lean())?.version).toBe(0);

    const list = await admin.get('/admin/escalations?status=active');
    const dto = escalationListSchema.parse(list.body);
    expect(dto.items).toHaveLength(1);
    expect(dto.counts).toEqual({ open: 1, acknowledged: 0 });
    expect(dto.items[0]?.subject.userId).toBe(e.id);
    expect(JSON.stringify(list.body)).not.toMatch(/@example\.com|passwordHash/);
    expect((await admin.get('/admin/escalations?status=bogus')).status).toBe(400);
    expect((await admin.get('/admin/escalations?nope=1')).status).toBe(400);
    expect((await admin.get('/admin/escalations?severity=critical')).body.total).toBe(0);
  });
});
