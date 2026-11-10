import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditLogListSchema } from '@csense/shared';
import { audit, createAuditService } from '../src/features/audit/audit.service.js';
import { makeCredentials } from './helpers/fixtures.js';
import { syncLearningIndexes } from './helpers/learningFixtures.js';
import {
  adminClient,
  buildGamificationApp,
  craftHighRiskEmployee,
} from './helpers/riskFixtures.js';
import { testChainSecret } from './helpers/testConfig.js';

let creds: { password: string; hash: string };

beforeAll(async () => {
  creds = await makeCredentials();
  await syncLearningIndexes();
});

const keysOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(keysOf)
    : typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)])
      : [];

describe('GET /admin/audit-logs', () => {
  it('AL1: filters by action, severity, target and time; cursor paging is dense and ordered', async () => {
    const t = await buildGamificationApp();
    const admin = await adminClient(t.app, creds); // writes login audit entries
    const target = new Types.ObjectId().toHexString();
    const day = (n: number) => new Date(Date.UTC(2026, 0, n, 12));
    for (const n of [1, 2, 3]) {
      await createAuditService({ chainSecret: testChainSecret, clock: () => day(n) }).record({
        action: 'user.created',
        outcome: 'success',
        severity: 'warning',
        target: { type: 'user', id: target },
        metadata: { n },
      });
    }
    for (let i = 0; i < 60; i += 1)
      await audit.record({ action: 'auth.logout', outcome: 'success' });

    const byAction = auditLogListSchema.parse(
      (await admin.get('/admin/audit-logs?action=user.created')).body,
    );
    expect(byAction.items.map((i) => i.metadata.n)).toEqual([3, 2, 1]);
    expect(byAction.nextCursor).toBeNull();
    expect((await admin.get('/admin/audit-logs?severity=warning')).body.items).toHaveLength(3);
    expect((await admin.get(`/admin/audit-logs?targetId=${target}`)).body.items).toHaveLength(3);
    expect(
      (await admin.get(`/admin/audit-logs?targetId=${target.toUpperCase()}`)).body.items,
    ).toHaveLength(3);
    const range = await admin.get(
      `/admin/audit-logs?targetId=${target}&from=${day(2).toISOString()}&to=${day(2).toISOString()}`,
    );
    expect((range.body.items as { metadata: { n: number } }[]).map((i) => i.metadata.n)).toEqual([
      2,
    ]);

    // Cursor paging over everything (login entries + 3 + 60).
    const seen: number[] = [];
    let cursor: number | null = null;
    for (let page = 0; page < 10; page += 1) {
      const res: { body: { items: { seq: number }[]; nextCursor: number | null } } =
        await admin.get(`/admin/audit-logs?limit=50${cursor ? `&before=${String(cursor)}` : ''}`);
      seen.push(...res.body.items.map((i) => i.seq));
      cursor = res.body.nextCursor;
      if (cursor === null) break;
    }
    expect(seen).toEqual([...seen].sort((a, b) => b - a));
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.at(0)).toBe(seen.length); // dense: newest seq equals the count
    expect(seen.at(-1)).toBe(1);

    for (const bad of [
      'limit=0',
      'limit=201',
      'before=0',
      'from=yesterday',
      'action=nope',
      'x=1',
      'targetId[$ne]=a',
    ]) {
      expect((await admin.get(`/admin/audit-logs?${bad}`)).status, bad).toBe(400);
    }
    expect(
      (await admin.get(`/admin/audit-logs?from=${day(3).toISOString()}&to=${day(1).toISOString()}`))
        .status,
    ).toBe(400);
  });

  it('AL2: the audit log is read-only: every other method is 404', async () => {
    const t = await buildGamificationApp();
    const admin = await adminClient(t.app, creds);
    const id = new Types.ObjectId().toHexString();
    for (const path of ['/admin/audit-logs', `/admin/audit-logs/${id}`]) {
      for (const call of [
        () => admin.post(path, {}),
        () => admin.put(path, {}),
        () => admin.patch(path, {}),
      ]) {
        expect((await call()).status, path).toBe(404);
      }
    }
    expect((await admin.get(`/admin/audit-logs/${id}`)).status).toBe(404);
    const { default: request } = await import('supertest');
    const del = await request(t.app)
      .delete('/api/v1/admin/audit-logs')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(del.status).toBe(404);
    const delOne = await request(t.app)
      .delete(`/api/v1/admin/audit-logs/${id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(delOne.status).toBe(404);
  });

  it('AL3: no item carries a password, token or secret key, or a note text', async () => {
    const t = await buildGamificationApp();
    const e = await craftHighRiskEmployee(t.g, creds);
    const admin = await adminClient(t.app, creds);
    const note = 'PRIVATE-NOTE-TEXT';
    await admin.patch(`/admin/escalations/${e.escalationId}`, { action: 'note', note });
    const res = await admin.get('/admin/audit-logs?limit=200');
    const body = auditLogListSchema.parse(res.body);
    expect(body.items.length).toBeGreaterThan(3);
    expect(keysOf(res.body).filter((k) => /pass|token|secret/i.test(k))).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain(note);
    expect(JSON.stringify(res.body)).not.toMatch(/@example\.com/);
    expect(body.items.every((i) => i.seq !== null && i.hash !== null && i.prevHash !== null)).toBe(
      true,
    );
  });
});
