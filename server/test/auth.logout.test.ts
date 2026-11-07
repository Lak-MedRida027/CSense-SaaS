import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog, AuthSession } from '../src/models/index.js';
import {
  bearer,
  buildTestApp,
  createEmployee,
  loginOk,
  makeCredentials,
  type SeedUser,
  type TestApp,
} from './helpers/fixtures.js';

let t: TestApp;
let creds: { password: string; hash: string };
let emp: SeedUser;

beforeAll(async () => {
  t = await buildTestApp();
  creds = await makeCredentials();
});

beforeEach(async () => {
  emp = await createEmployee(creds);
});

const logout = (refreshToken: unknown) =>
  request(t.app).post('/api/v1/auth/logout').send({ refreshToken });

describe('POST /auth/logout', () => {
  it('O1: returns 204, kills refresh and access tokens, and audits', async () => {
    const login = await loginOk(t.app, emp);
    const res = await logout(login.refreshToken);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');

    const refresh = await request(t.app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.refreshToken });
    expect(refresh.status).toBe(401);
    const me = await request(t.app)
      .get('/api/v1/auth/me')
      .set(...bearer(login.accessToken));
    expect(me.status).toBe(401);

    const session = await AuthSession.findOne().lean();
    expect(session?.revokedReason).toBe('logout');
    const entry = await AuditLog.findOne({ action: 'auth.logout' }).lean();
    expect(entry).toMatchObject({ outcome: 'success', targetType: 'session' });
    expect(entry?.actorId?.toString()).toBe(emp.id);
  });

  it('O1: logging out with a spent (rotated) token also revokes the session', async () => {
    const login = await loginOk(t.app, emp);
    const rotated = await request(t.app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.refreshToken });
    expect((await logout(login.refreshToken)).status).toBe(204);
    const me = await request(t.app)
      .get('/api/v1/auth/me')
      .set(...bearer(rotated.body.accessToken as string));
    expect(me.status).toBe(401);
  });

  it('O1: a spent token at logout is reuse: critical audit, reason reuse_detected, still 204', async () => {
    const login = await loginOk(t.app, emp);
    const rotated = await request(t.app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.refreshToken });
    expect((await logout(login.refreshToken)).status).toBe(204);
    const session = await AuthSession.findOne().lean();
    expect(session?.revokedReason).toBe('reuse_detected');
    const entry = await AuditLog.findOne({ action: 'auth.refresh.reuse_detected' }).lean();
    expect(entry).toMatchObject({
      severity: 'critical',
      outcome: 'failure',
      targetType: 'session',
    });
    expect(entry?.metadata).toMatchObject({ userId: emp.id, via: 'logout' });
    expect(await AuditLog.countDocuments({ action: 'auth.logout' })).toBe(0);
    // Replaying again, or logging out with the live token afterwards, writes nothing more.
    expect((await logout(login.refreshToken)).status).toBe(204);
    expect((await logout(rotated.body.refreshToken as string)).status).toBe(204);
    expect(await AuditLog.countDocuments({ action: 'auth.refresh.reuse_detected' })).toBe(1);
  });

  it('O2: an unknown token returns 204 and changes nothing', async () => {
    const login = await loginOk(t.app, emp);
    const [sid] = login.refreshToken.split('.');
    for (const bad of [
      'garbage',
      `${String(sid)}.${'A'.repeat(43)}`,
      `${'0'.repeat(24)}.${'A'.repeat(43)}`,
    ]) {
      expect((await logout(bad)).status).toBe(204);
    }
    const session = await AuthSession.findOne().lean();
    expect(session?.revokedAt).toBeNull();
    expect(await AuditLog.countDocuments({ action: 'auth.logout' })).toBe(0);
  });

  it('O3: a second logout returns 204 and is not audited twice', async () => {
    const login = await loginOk(t.app, emp);
    expect((await logout(login.refreshToken)).status).toBe(204);
    expect((await logout(login.refreshToken)).status).toBe(204);
    expect(await AuditLog.countDocuments({ action: 'auth.logout' })).toBe(1);
  });

  it('O4: other sessions of the same user are unaffected', async () => {
    const first = await loginOk(t.app, emp);
    const second = await loginOk(t.app, emp);
    expect((await logout(first.refreshToken)).status).toBe(204);
    const me = await request(t.app)
      .get('/api/v1/auth/me')
      .set(...bearer(second.accessToken));
    expect(me.status).toBe(200);
    const refresh = await request(t.app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: second.refreshToken });
    expect(refresh.status).toBe(200);
  });

  it('O5: a missing or malformed body returns 400', async () => {
    expect((await request(t.app).post('/api/v1/auth/logout')).status).toBe(400);
    expect((await request(t.app).post('/api/v1/auth/logout').send({})).status).toBe(400);
    expect((await logout(42)).status).toBe(400);
  });
});
