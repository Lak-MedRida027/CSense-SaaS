import { SignJWT } from 'jose';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthSession, Employee } from '../src/models/index.js';
import {
  bearer,
  buildTestApp,
  createAdmin,
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

const me = (header?: [string, string]) => {
  const r = request(t.app).get('/api/v1/auth/me');
  return header ? r.set(header[0], header[1]) : r;
};

const forge = async (claims: { sub: string; sid: string; role: string }, secret?: string) => {
  const now = Math.floor(t.clock().getTime() / 1000);
  return new SignJWT({ role: claims.role, sid: claims.sid })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer('csense-api')
    .setAudience('csense-desktop')
    .setIssuedAt(now)
    .setExpirationTime(now + 900)
    .setJti('forged')
    .sign(new TextEncoder().encode(secret ?? t.config.jwtAccessSecret));
};

const UNAUTH = { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } };

describe('GET /auth/me', () => {
  it('A1: a valid token returns the user DTO', async () => {
    const { accessToken } = await loginOk(t.app, emp);
    const res = await me(bearer(accessToken));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: emp.id,
      email: emp.email,
      role: 'employee',
      totalXP: 0,
      level: 'Apprentice',
    });
    expect(res.body).not.toHaveProperty('passwordHash');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('A2: no header returns 401 UNAUTHENTICATED with WWW-Authenticate', async () => {
    const res = await me();
    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTH);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it.each([
    ['wrong scheme', 'Token aaa.bbb.ccc'],
    ['no token', 'Bearer'],
    ['two tokens', 'Bearer a b'],
    ['not a JWT', 'Bearer not-a-jwt'],
    ['oversized', `Bearer ${'a'.repeat(2100)}.b.c`],
  ])('A3: malformed header (%s) returns 401', async (_n, value) => {
    const res = await me(['Authorization', value]);
    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTH);
  });

  it('A4: a bad signature or alg:none returns 401', async () => {
    const { accessToken } = await loginOk(t.app, emp);
    const [h, p, s] = accessToken.split('.');
    const badSig = `${String(h)}.${String(p)}.${String(s).split('').reverse().join('')}`;
    expect((await me(bearer(badSig))).status).toBe(401);

    const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
      'base64url',
    );
    expect((await me(bearer(`${noneHeader}.${String(p)}.`))).status).toBe(401);

    const otherSecret = await forge(
      { sub: emp.id, sid: '0'.repeat(24), role: 'employee' },
      'a-different-secret-that-is-at-least-32-chars-long',
    );
    expect((await me(bearer(otherSecret))).status).toBe(401);
  });

  it('A5: an expired token returns the same 401 body as an invalid one', async () => {
    const { accessToken } = await loginOk(t.app, emp);
    const invalid = await me(bearer('aaa.bbb.ccc'));
    t.advance(16 * 60_000);
    const expired = await me(bearer(accessToken));
    expect(expired.status).toBe(401);
    expect(expired.body).toEqual(invalid.body);
    expect(expired.headers['www-authenticate']).toBe('Bearer');
  });

  it('A6: 401 for a deleted user', async () => {
    const { accessToken } = await loginOk(t.app, emp);
    await Employee.deleteOne({ _id: emp.id });
    expect((await me(bearer(accessToken))).status).toBe(401);
  });

  it('A6: 401 for a user deactivated after login', async () => {
    const { accessToken } = await loginOk(t.app, emp);
    expect((await me(bearer(accessToken))).status).toBe(200);
    await Employee.updateOne({ _id: emp.id }, { isActive: false });
    expect((await me(bearer(accessToken))).status).toBe(401);
  });

  it('A6: 401 once the session is revoked by logout', async () => {
    const { accessToken, refreshToken } = await loginOk(t.app, emp);
    await request(t.app).post('/api/v1/auth/logout').send({ refreshToken });
    expect((await me(bearer(accessToken))).status).toBe(401);
  });

  it('A6: 401 for a forged role claim signed with the real secret', async () => {
    await loginOk(t.app, emp);
    const session = await AuthSession.findOne({ userId: emp.id }).lean();
    const forged = await forge({
      sub: emp.id,
      sid: String(session?._id),
      role: 'administrator',
    });
    expect((await me(bearer(forged))).status).toBe(401);
  });

  it('A6: 401 when the session belongs to a different user', async () => {
    const other = await createAdmin(creds);
    await loginOk(t.app, other);
    const session = await AuthSession.findOne({ userId: other.id }).lean();
    const forged = await forge({ sub: emp.id, sid: String(session?._id), role: 'employee' });
    expect((await me(bearer(forged))).status).toBe(401);
  });

  it('A6: 401 once the session has expired', async () => {
    const { accessToken } = await loginOk(t.app, emp);
    await AuthSession.updateOne(
      { userId: emp.id },
      { expiresAt: new Date(t.clock().getTime() - 1) },
    );
    expect((await me(bearer(accessToken))).status).toBe(401);
  });

  it('A7: an unknown query parameter returns 400', async () => {
    const { accessToken } = await loginOk(t.app, emp);
    const res = await request(t.app)
      .get('/api/v1/auth/me?debug=1')
      .set(...bearer(accessToken));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
