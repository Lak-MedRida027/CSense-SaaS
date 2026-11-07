import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog, AuthSession, Employee } from '../src/models/index.js';
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

const refresh = (refreshToken: unknown) =>
  request(t.app).post('/api/v1/auth/refresh').send({ refreshToken });
const me = (token: string) =>
  request(t.app)
    .get('/api/v1/auth/me')
    .set(...bearer(token));
const INVALID = {
  error: { code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token is invalid or expired' },
};

describe('POST /auth/refresh', () => {
  it('F1: rotates the token, keeps the absolute expiry, and the new access token works', async () => {
    const login = await loginOk(t.app, emp);
    const before = await AuthSession.findOne().select('+currentTokenHash').lean();

    const res = await refresh(login.refreshToken);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.refreshToken).not.toBe(login.refreshToken);
    expect(res.body.accessToken).not.toBe(login.accessToken);
    expect(res.body.refreshTokenExpiresAt).toBe(login.refreshTokenExpiresAt);
    expect(res.body).toMatchObject({ tokenType: 'Bearer', accessTokenExpiresIn: 900 });
    expect(res.body).not.toHaveProperty('user');
    expect((await me(res.body.accessToken as string)).status).toBe(200);

    const after = await AuthSession.findOne().select('+currentTokenHash').lean();
    expect(after?.currentTokenHash).not.toBe(before?.currentTokenHash);
    expect(after?.rotationCount).toBe(1);

    // The new token rotates again.
    expect((await refresh(res.body.refreshToken)).status).toBe(200);
  });

  it('F2: reusing a rotated token revokes the whole family and writes a critical audit entry', async () => {
    const login = await loginOk(t.app, emp);
    const rotated = await refresh(login.refreshToken);
    expect(rotated.status).toBe(200);

    const reuse = await refresh(login.refreshToken);
    expect(reuse.status).toBe(401);
    expect(reuse.body).toEqual(INVALID);

    const session = await AuthSession.findOne().lean();
    expect(session?.revokedReason).toBe('reuse_detected');
    expect(session?.revokedAt).toBeTruthy();

    expect((await refresh(rotated.body.refreshToken)).status).toBe(401);
    expect((await me(rotated.body.accessToken as string)).status).toBe(401);
    expect((await me(login.accessToken)).status).toBe(401);

    const entry = await AuditLog.findOne({ action: 'auth.refresh.reuse_detected' }).lean();
    expect(entry).toMatchObject({
      severity: 'critical',
      outcome: 'failure',
      targetType: 'session',
    });
    expect(JSON.stringify(entry)).not.toContain(login.refreshToken);
  });

  it('F3: garbage tokens return 401 with no state change; a wrong secret does not revoke', async () => {
    const login = await loginOk(t.app, emp);
    for (const bad of ['garbage', 'a.b', 'x'.repeat(150), `${'0'.repeat(24)}.${'A'.repeat(43)}`]) {
      const res = await refresh(bad);
      expect(res.status).toBe(401);
      expect(res.body).toEqual(INVALID);
    }
    const [sid] = login.refreshToken.split('.');
    const wrongSecret = await refresh(`${String(sid)}.${'A'.repeat(43)}`);
    expect(wrongSecret.status).toBe(401);
    const session = await AuthSession.findOne().lean();
    expect(session?.revokedAt).toBeNull();
    expect(session?.rotationCount).toBe(0);
    // The real token is unaffected.
    expect((await refresh(login.refreshToken)).status).toBe(200);
  });

  it('F4: a token past the absolute expiry returns 401', async () => {
    const login = await loginOk(t.app, emp);
    t.advance((7 * 86_400 + 1) * 1000);
    const res = await refresh(login.refreshToken);
    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID);
  });

  it('F5: a deactivated user is refused, the session revoked and the denial audited', async () => {
    const login = await loginOk(t.app, emp);
    await Employee.updateOne({ _id: emp.id }, { isActive: false });
    const res = await refresh(login.refreshToken);
    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID);
    const session = await AuthSession.findOne().lean();
    expect(session?.revokedReason).toBe('user_inactive');
    const entry = await AuditLog.findOne({ action: 'auth.refresh.denied' }).lean();
    expect(entry?.metadata).toMatchObject({ reason: 'user_inactive' });
  });

  it.each([
    ['missing', {}],
    ['non-string', { refreshToken: 123 }],
    ['object', { refreshToken: { $ne: null } }],
    ['extra field', { refreshToken: 'abc', admin: true }],
    ['too long', { refreshToken: 'x'.repeat(201) }],
  ])('F6: %s returns 400', async (_n, body) => {
    const res = await request(t.app).post('/api/v1/auth/refresh').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('F7: two concurrent refreshes with the same token give one 200 and one 401, family revoked', async () => {
    const login = await loginOk(t.app, emp);
    const [a, b] = await Promise.all([refresh(login.refreshToken), refresh(login.refreshToken)]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
    const session = await AuthSession.findOne().lean();
    expect(session?.revokedReason).toBe('reuse_detected');
    const winner = a.status === 200 ? a : b;
    expect((await refresh(winner.body.refreshToken)).status).toBe(401);
  });

  it('F8: an access JWT is not a refresh token, and a refresh token is not a bearer token', async () => {
    const login = await loginOk(t.app, emp);
    // An access JWT is longer than the refresh-token limit, so it fails validation or parsing.
    expect([400, 401]).toContain((await refresh(login.accessToken)).status);
    expect((await me(login.refreshToken)).status).toBe(401);
    const session = await AuthSession.findOne().lean();
    expect(session?.revokedAt).toBeNull();
  });
});
