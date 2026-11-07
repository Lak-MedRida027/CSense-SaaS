import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { Escalation } from '../src/models/index.js';
import { createEmployee, makeCredentials, loginOk } from './helpers/fixtures.js';
import { clientFor } from './helpers/learningFixtures.js';
import { buildGamificationApp, craftHighRiskEmployee } from './helpers/riskFixtures.js';

let creds: { password: string; hash: string };

beforeAll(async () => {
  creds = await makeCredentials();
});

describe('Phase 4 authorisation sweep', () => {
  it('B8: an employee is denied every admin read and write, learns nothing, and changes nothing', async () => {
    const t = await buildGamificationApp();
    const victim = await craftHighRiskEmployee(t.g, creds);
    const attacker = await createEmployee(creds);
    const { accessToken } = await loginOk(t.app, attacker);
    const emp = clientFor(t.app, attacker, accessToken);
    const before = JSON.stringify(await Escalation.findById(victim.escalationId).lean());

    const attempts = [
      emp.get(`/admin/users/${victim.id}/risk-profile`),
      emp.get(`/admin/users/${attacker.id}/risk-profile`),
      emp.get(`/admin/escalations/${victim.escalationId}`),
      emp.patch(`/admin/escalations/${victim.escalationId}`, {
        action: 'acknowledge',
        expectedVersion: 0,
      }),
      emp.patch(`/admin/escalations/${victim.escalationId}`, { action: 'note', note: 'hello' }),
      emp.get(`/admin/audit-logs?targetId=${attacker.id}`),
      emp.get('/admin/audit-logs'),
      emp.get('/admin/escalations'),
      emp.get(`/admin/escalations?userId=${victim.id}`),
      emp.get('/admin/risk-profiles'),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: { code: 'FORBIDDEN', message: expect.any(String) as unknown },
      });
    }
    expect(JSON.stringify(await Escalation.findById(victim.escalationId).lean())).toBe(before);
  });

  it('B8b: even a malformed request from an employee is a 403, not a validation error that leaks shape', async () => {
    const t = await buildGamificationApp();
    const attacker = await createEmployee(creds);
    const { accessToken } = await loginOk(t.app, attacker);
    const emp = clientFor(t.app, attacker, accessToken);
    expect((await emp.get('/admin/audit-logs?limit=9999')).status).toBe(403);
    expect((await emp.patch('/admin/escalations/not-an-id', { junk: true })).status).toBe(403);
  });

  it('B9: no token is 401 on every Phase 4 route and no route accepts a user id in the path for /me', async () => {
    const t = await buildGamificationApp();
    for (const [method, path] of [
      ['get', '/me/xp'],
      ['get', '/me/badges'],
      ['get', '/admin/risk-profiles'],
      ['get', '/admin/escalations'],
      ['patch', '/admin/escalations/aaaaaaaaaaaaaaaaaaaaaaaa'],
      ['get', '/admin/audit-logs'],
    ] as const) {
      expect((await request(t.app)[method](`/api/v1${path}`)).status, path).toBe(401);
    }
    const attacker = await createEmployee(creds);
    const { accessToken } = await loginOk(t.app, attacker);
    const emp = clientFor(t.app, attacker, accessToken);
    expect((await emp.get(`/me/${attacker.id}/xp`)).status).toBe(404);
    expect((await emp.get('/me/risk')).status).toBe(404);
  });
});
