import { describe, expect, it } from 'vitest';
import { badgeAuthoringSchema } from './badgeAuthoring.js';
import { listAuditLogsQuerySchema } from './auditLogs.js';
import { auditLogSchema } from './auditLogResponses.js';
import { escalationActionRequestSchema, listEscalationsQuerySchema } from './governance.js';
import { escalationSummarySchema } from './governanceResponses.js';
import { listRiskProfilesQuerySchema } from './risk.js';

const ID = 'a'.repeat(24);

describe('escalation action request', () => {
  const ok = (body: unknown): boolean => escalationActionRequestSchema.safeParse(body).success;

  it('SC1: accepts the three valid shapes', () => {
    expect(ok({ action: 'acknowledge', expectedVersion: 0 })).toBe(true);
    expect(ok({ action: 'acknowledge', expectedVersion: 0, note: 'looking' })).toBe(true);
    expect(ok({ action: 'note', note: 'hello\nworld\tok' })).toBe(true);
    expect(
      ok({ action: 'resolve', expectedVersion: 1, resolution: 'remediated', note: 'done' }),
    ).toBe(true);
  });

  it('SC1: rejects the malformed ones', () => {
    expect(ok({ action: 'delete', expectedVersion: 0 })).toBe(false);
    expect(ok({ action: 'resolve', expectedVersion: 1, resolution: 'remediated' })).toBe(false);
    expect(ok({ action: 'acknowledge', expectedVersion: 0, status: 'resolved' })).toBe(false);
    expect(ok({ action: 'note', note: 'x'.repeat(2001) })).toBe(false);
    expect(ok({ action: 'note', note: 'x'.repeat(2000) })).toBe(true);
    expect(ok({ action: 'acknowledge', expectedVersion: -1 })).toBe(false);
    expect(ok({ action: 'acknowledge', expectedVersion: 1.5 })).toBe(false);
    expect(ok({ action: 'acknowledge' })).toBe(false);
    expect(ok({ action: 'note', note: '   ' })).toBe(false);
    expect(ok({ action: 'note', note: 'bell\u0007' })).toBe(false);
    expect(ok({ action: 'resolve', expectedVersion: 1, resolution: 'whatever', note: 'x' })).toBe(
      false,
    );
    expect(ok(JSON.parse('{"action":"note","note":"x","__proto__":{"admin":true}}'))).toBe(false);
    expect(ok('acknowledge')).toBe(false);
    expect(ok(null)).toBe(false);
  });
});

describe('list queries', () => {
  it('SC2: coerce and bound page, pageSize, limit and before', () => {
    expect(listRiskProfilesQuerySchema.parse({ page: '2', pageSize: '10' })).toMatchObject({
      page: 2,
      pageSize: 10,
      sort: 'composite_desc',
    });
    expect(listRiskProfilesQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 25 });
    for (const bad of [
      { page: '0' },
      { pageSize: '101' },
      { pageSize: '0' },
      { page: '10001' },
      { level: 'x' },
    ]) {
      expect(listRiskProfilesQuerySchema.safeParse(bad).success).toBe(false);
    }
    expect(listAuditLogsQuerySchema.parse({}).limit).toBe(50);
    expect(listAuditLogsQuerySchema.parse({ limit: '200', before: '5' })).toMatchObject({
      limit: 200,
      before: 5,
    });
    for (const bad of [
      { limit: '0' },
      { limit: '201' },
      { before: '0' },
      { before: 'x' },
      { action: 'nope' },
    ]) {
      expect(listAuditLogsQuerySchema.safeParse(bad).success).toBe(false);
    }
  });

  it('SC2: unknown parameters and array or operator forms are rejected', () => {
    expect(listEscalationsQuerySchema.safeParse({ nope: '1' }).success).toBe(false);
    expect(listEscalationsQuerySchema.safeParse({ status: ['open', 'resolved'] }).success).toBe(
      false,
    );
    expect(listEscalationsQuerySchema.safeParse({ userId: { $ne: ID } }).success).toBe(false);
    expect(listAuditLogsQuerySchema.safeParse({ targetId: { $ne: ID } }).success).toBe(false);
    expect(
      listEscalationsQuerySchema.safeParse({ status: 'active', userId: ID.toUpperCase() }).success,
    ).toBe(true);
  });

  it('SC2: from after to is rejected, from before to is accepted', () => {
    expect(
      listAuditLogsQuerySchema.safeParse({
        from: '2026-02-01T00:00:00Z',
        to: '2026-01-01T00:00:00Z',
      }).success,
    ).toBe(false);
    expect(
      listAuditLogsQuerySchema.safeParse({
        from: '2026-01-01T00:00:00Z',
        to: '2026-02-01T00:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(listAuditLogsQuerySchema.safeParse({ from: 'yesterday' }).success).toBe(false);
  });
});

describe('response schemas', () => {
  it('SC3: reject an extra field such as an email or password hash on the subject', () => {
    const summary = {
      id: ID,
      reason: 'risk_level_high',
      severity: 'elevated',
      reviewTier: 'security_team',
      status: 'open',
      subject: { userId: ID, name: 'A', department: null },
      riskLevel: 'High',
      compositeScore: 71,
      openedAt: new Date().toISOString(),
      acknowledgedAt: null,
      resolvedAt: null,
      assignee: null,
      version: 0,
    };
    expect(escalationSummarySchema.safeParse(summary).success).toBe(true);
    expect(
      escalationSummarySchema.safeParse({
        ...summary,
        subject: { ...summary.subject, email: 'a@b.co' },
      }).success,
    ).toBe(false);
    expect(escalationSummarySchema.safeParse({ ...summary, passwordHash: 'x' }).success).toBe(
      false,
    );
    expect(auditLogSchema.safeParse({ nope: 1 }).success).toBe(false);
  });
});

describe('badge authoring', () => {
  it('SC4: rejects an unknown motif and an empty name', () => {
    expect(
      badgeAuthoringSchema.safeParse({ name: 'First Steps', iconMotif: 'welcome' }).success,
    ).toBe(true);
    expect(badgeAuthoringSchema.safeParse({ name: 'X', iconMotif: 'not-a-motif' }).success).toBe(
      false,
    );
    expect(badgeAuthoringSchema.safeParse({ name: '   ', iconMotif: 'welcome' }).success).toBe(
      false,
    );
    expect(
      badgeAuthoringSchema.safeParse({ name: 'x'.repeat(121), iconMotif: 'welcome' }).success,
    ).toBe(false);
    expect(
      badgeAuthoringSchema.safeParse({ name: 'X', iconMotif: 'welcome', moduleId: ID }).success,
    ).toBe(false);
  });
});
