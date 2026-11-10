import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { escalationDetailSchema } from '@csense/shared';
import { audit, createAuditService } from '../src/features/audit/audit.service.js';
import { AuditLog, Escalation } from '../src/models/index.js';
import { createEmployee, makeCredentials } from './helpers/fixtures.js';
import { syncLearningIndexes } from './helpers/learningFixtures.js';
import {
  adminClient,
  buildGamificationApp,
  craftHighRiskEmployee,
  verifyAuditChain,
} from './helpers/riskFixtures.js';
import { testChainSecret } from './helpers/testConfig.js';

let creds: { password: string; hash: string };

beforeAll(async () => {
  creds = await makeCredentials();
  await syncLearningIndexes();
});

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** An acknowledged elevated, security-team escalation plus two administrators. */
async function elevated(overrides: Parameters<typeof buildGamificationApp>[0] = {}) {
  const t = await buildGamificationApp(overrides);
  const e = await craftHighRiskEmployee(t.g, creds);
  const a = await adminClient(t.app, creds);
  const b = await adminClient(t.app, creds);
  const path = `/admin/escalations/${e.escalationId}`;
  expect((await a.patch(path, { action: 'acknowledge', expectedVersion: 0 })).status).toBe(200);
  return { t, e, a, b, path, id: e.escalationId };
}

/** An acknowledged critical, management-tier escalation (a gate restriction). */
async function critical() {
  const t = await buildGamificationApp();
  const emp = await createEmployee(creds);
  const { escalationId } = await t.g.escalations.recordCriticalEvent({
    userId: emp.id,
    reason: 'gate_access_restricted',
    sourceRef: { type: 'gate_event', id: new Types.ObjectId().toHexString() },
    occurredAt: new Date(),
  });
  const a = await adminClient(t.app, creds);
  const b = await adminClient(t.app, creds);
  const path = `/admin/escalations/${escalationId}`;
  expect((await a.patch(path, { action: 'acknowledge', expectedVersion: 0 })).status).toBe(200);
  return { t, a, b, path, id: escalationId };
}

const resolveBody = (over: Record<string, unknown> = {}) => ({
  action: 'resolve',
  expectedVersion: 1,
  resolution: 'remediated',
  note: 'SECRET-NOTE-TEXT',
  ...over,
});

describe('P4-L8: separation of duties on resolve', () => {
  it('SD1: an ordinary elevated escalation may be resolved by the administrator who acknowledged it', async () => {
    const { a, path } = await elevated();
    const res = await a.patch(path, resolveBody());
    expect(res.status).toBe(200);
    const dto = escalationDetailSchema.parse(res.body);
    expect(dto.acknowledgedBy).toMatchObject({ id: a.id, name: 'Test Admin' });
    expect(dto.resolvedBy).toMatchObject({ id: a.id });
    expect(dto.events.at(-1)?.sameAdmin).toBe(false);
  });

  it('SD2: risk_accepted by the acknowledger is refused with 403; nothing changes; a warning is audited without note text', async () => {
    const { a, b, e, path } = await elevated();
    const before = JSON.stringify(await Escalation.findById(e.escalationId).lean());
    const res = await a.patch(path, resolveBody({ resolution: 'risk_accepted' }));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SEPARATION_OF_DUTIES');
    expect(JSON.stringify(await Escalation.findById(e.escalationId).lean())).toBe(before);
    const refused = await AuditLog.find({ action: 'escalation.resolve_refused' }).lean();
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({
      severity: 'warning',
      outcome: 'failure',
      targetType: 'escalation',
      actorRole: 'administrator',
    });
    expect(refused[0]?.actorId?.toHexString()).toBe(a.id);
    expect(refused[0]?.metadata).toMatchObject({
      reason: 'same_admin',
      resolution: 'risk_accepted',
      status: 'acknowledged',
    });
    expect(JSON.stringify(refused)).not.toContain('SECRET-NOTE-TEXT');
    expect(JSON.stringify(refused)).not.toContain(sha256('SECRET-NOTE-TEXT'));

    // A different administrator can resolve it, and it is audited as a warning.
    const ok = await b.patch(path, resolveBody({ resolution: 'risk_accepted' }));
    expect(ok.status).toBe(200);
    expect(ok.body.resolvedBy.id).toBe(b.id);
    expect(ok.body.acknowledgedBy.id).toBe(a.id);
    expect((await AuditLog.findOne({ action: 'escalation.resolved' }).lean())?.severity).toBe(
      'warning',
    );
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it('SD3: a critical escalation needs a second administrator whatever its tier', async () => {
    const { a, b, path, id } = await critical();
    await Escalation.collection.updateOne(
      { _id: new Types.ObjectId(id) },
      { $set: { reviewTier: 'security_team' } },
    );
    const res = await a.patch(path, resolveBody());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SEPARATION_OF_DUTIES');
    expect((await Escalation.findById(id).lean())?.status).toBe('acknowledged');
    expect((await b.patch(path, resolveBody())).status).toBe(200);
  });

  it('SD4: a management-tier escalation needs a second administrator whatever its severity', async () => {
    const { a, b, path, id } = await critical();
    await Escalation.collection.updateOne(
      { _id: new Types.ObjectId(id) },
      { $set: { severity: 'elevated' } },
    );
    const body = resolveBody({ managementReference: 'MGMT-1' });
    const res = await a.patch(path, body);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SEPARATION_OF_DUTIES');
    const ok = await b.patch(path, body);
    expect(ok.status).toBe(200);
    expect(ok.body.resolvedBy.id).toBe(b.id);
  });

  it('SD5: resolving such an escalation straight from open is refused with 403 for any administrator; others stay 409', async () => {
    const t = await buildGamificationApp();
    const emp = await createEmployee(creds);
    const { escalationId } = await t.g.escalations.recordCriticalEvent({
      userId: emp.id,
      reason: 'gate_access_restricted',
      sourceRef: { type: 'gate_event', id: new Types.ObjectId().toHexString() },
      occurredAt: new Date(),
    });
    const a = await adminClient(t.app, creds);
    const path = `/admin/escalations/${escalationId}`;
    const res = await a.patch(path, resolveBody({ expectedVersion: 0, managementReference: 'M' }));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SEPARATION_OF_DUTIES');
    expect(
      (await AuditLog.findOne({ action: 'escalation.resolve_refused' }).lean())?.metadata,
    ).toMatchObject({
      reason: 'not_acknowledged',
      status: 'open',
    });
    expect((await Escalation.findById(escalationId).lean())?.status).toBe('open');

    // An ordinary escalation resolved from open is still the plain state error.
    const e = await craftHighRiskEmployee(t.g, creds);
    const plain = await a.patch(
      `/admin/escalations/${e.escalationId}`,
      resolveBody({ expectedVersion: 0 }),
    );
    expect(plain.status).toBe(409);
    expect(plain.body.error.code).toBe('INVALID_STATE_TRANSITION');
    // risk_accepted from open is a separation-of-duties refusal too.
    const accepted = await a.patch(
      `/admin/escalations/${e.escalationId}`,
      resolveBody({ expectedVersion: 0, resolution: 'risk_accepted' }),
    );
    expect(accepted.status).toBe(403);
  });

  it('SD6: ESCALATION_REQUIRE_SECOND_ADMIN=false lets the same administrator resolve, marked sameAdmin and audited as a warning', async () => {
    const { a, path } = await elevated({ governance: { requireSecondAdmin: false } });
    const res = await a.patch(path, resolveBody({ resolution: 'risk_accepted' }));
    expect(res.status).toBe(200);
    expect((res.body.events as unknown[]).at(-1)).toMatchObject({
      type: 'resolved',
      sameAdmin: true,
    });
    const entry = await AuditLog.findOne({ action: 'escalation.resolved' }).lean();
    expect(entry?.severity).toBe('warning');
    expect(entry?.metadata).toMatchObject({ sameAdmin: true, resolution: 'risk_accepted' });
    expect(await AuditLog.countDocuments({ action: 'escalation.resolve_refused' })).toBe(0);
  });

  it('SD6b: with the flag off a different administrator is not marked, and open-to-resolve stays a state error', async () => {
    const { b, path, id } = await elevated({ governance: { requireSecondAdmin: false } });
    const res = await b.patch(path, resolveBody({ resolution: 'risk_accepted' }));
    expect(res.status).toBe(200);
    expect((res.body.events as { sameAdmin: boolean }[]).at(-1)?.sameAdmin).toBe(false);
    expect(
      (await AuditLog.findOne({ action: 'escalation.resolved' }).lean())?.metadata,
    ).not.toHaveProperty('sameAdmin');

    const t = await buildGamificationApp({ governance: { requireSecondAdmin: false } });
    const emp = await createEmployee(creds);
    const made = await t.g.escalations.recordCriticalEvent({
      userId: emp.id,
      reason: 'gate_access_restricted',
      sourceRef: { type: 'gate_event', id: new Types.ObjectId().toHexString() },
      occurredAt: new Date(),
    });
    const a = await adminClient(t.app, creds);
    const open = await a.patch(
      `/admin/escalations/${made.escalationId}`,
      resolveBody({ expectedVersion: 0, managementReference: 'M' }),
    );
    expect(open.status).toBe(409);
    expect(id).toBeTruthy();
  });

  it('SD7: two administrators racing to acknowledge and then to resolve can never end with the same person on both', async () => {
    const t = await buildGamificationApp();
    const e = await craftHighRiskEmployee(t.g, creds);
    const a = await adminClient(t.app, creds);
    const b = await adminClient(t.app, creds);
    const path = `/admin/escalations/${e.escalationId}`;
    const acks = await Promise.all(
      [a, b].map((c) => c.patch(path, { action: 'acknowledge', expectedVersion: 0 })),
    );
    expect(acks.map((r) => r.status).sort()).toEqual([200, 409]);
    const resolves = await Promise.all(
      [a, b].map((c) => c.patch(path, resolveBody({ resolution: 'risk_accepted' }))),
    );
    // Exactly one resolve wins. The acknowledger's request is refused either way: 403
    // SEPARATION_OF_DUTIES when it is evaluated while the escalation is still acknowledged, or the
    // plain 409 state error when the other administrator's resolve has already committed (a resolved
    // escalation is always the state error). Which one depends on scheduling, not on the rule.
    const statuses = resolves.map((r) => r.status).sort();
    expect(statuses[0]).toBe(200);
    expect([403, 409]).toContain(statuses[1]);
    const stored = await Escalation.findById(e.escalationId).lean();
    expect(stored?.status).toBe('resolved');
    expect(stored?.acknowledgedBy?.toHexString()).not.toBe(stored?.resolvedBy?.toHexString());
    expect(await AuditLog.countDocuments({ action: 'escalation.resolve_refused' })).toBe(
      statuses[1] === 403 ? 1 : 0,
    );
    expect(await AuditLog.countDocuments({ action: 'escalation.resolved' })).toBe(1);
  });

  it('SD8: the acknowledger check is part of the conditional write, so a stale read cannot bypass it', async () => {
    const { a, path, id } = await elevated();
    // Simulate the race window: the service has already read an escalation whose acknowledger
    // looked different. The write itself still refuses because the stored acknowledger is the actor.
    const original = Escalation.findById.bind(Escalation);
    let first = true;
    const spy = vi.spyOn(Escalation, 'findById').mockImplementation(((...args: unknown[]) => {
      const query = (
        original as (...a: unknown[]) => { lean: (...x: unknown[]) => Promise<unknown> }
      )(...args);
      if (first) {
        first = false;
        const lean = query.lean.bind(query);
        query.lean = async (...x: unknown[]) => {
          const doc = (await lean(...x)) as { acknowledgedBy?: unknown } | null;
          return doc ? { ...doc, acknowledgedBy: new Types.ObjectId() } : doc;
        };
      }
      return query;
    }) as never);
    let res;
    try {
      res = await a.patch(path, resolveBody({ resolution: 'risk_accepted' }));
    } finally {
      spy.mockRestore();
    }
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SEPARATION_OF_DUTIES');
    expect((await Escalation.findById(id).lean())?.status).toBe('acknowledged');
  });

  it('SD9: a refusal is still a 403 and changes nothing when its audit entry cannot be written', async () => {
    const { a, path, id } = await elevated();
    const real = createAuditService({ chainSecret: testChainSecret });
    const spy = vi
      .spyOn(audit, 'record')
      .mockImplementation((input) =>
        input.action === 'escalation.resolve_refused'
          ? Promise.reject(new Error('audit down'))
          : real.record(input),
      );
    let res;
    try {
      res = await a.patch(path, resolveBody({ resolution: 'risk_accepted' }));
    } finally {
      spy.mockRestore();
    }
    expect(res.status).toBe(403);
    expect((await Escalation.findById(id).lean())?.status).toBe('acknowledged');
  });

  it('SD10: employees still get nothing: the new code is only reachable by administrators', async () => {
    const t = await buildGamificationApp();
    const e = await craftHighRiskEmployee(t.g, creds);
    const { employeeClient } = await import('./helpers/riskFixtures.js');
    const emp = await employeeClient(t.app, creds);
    const res = await emp.patch(`/admin/escalations/${e.escalationId}`, resolveBody());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
