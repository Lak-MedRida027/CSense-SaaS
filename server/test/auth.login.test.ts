import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRounds, hashPassword } from '../src/features/auth/password.js';
import { Administrator, AuditLog, AuthSession, Employee } from '../src/models/index.js';
import {
  buildTestApp,
  createAdmin,
  createEmployee,
  makeCredentials,
  randomPassword,
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

afterEach(() => {
  vi.restoreAllMocks();
});

const post = (body: unknown) =>
  request(t.app)
    .post('/api/v1/auth/login')
    .send(body as object);

/** Headers that legitimately differ between otherwise identical responses. */
const comparableHeaders = (headers: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(headers).filter(
      ([k]) => !['date', 'x-request-id', 'etag'].includes(k) && !k.startsWith('ratelimit'),
    ),
  );

describe('POST /auth/login', () => {
  it('L1: employee happy path returns the token response and stores only hashes', async () => {
    const res = await post({ email: emp.email, password: emp.password });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      tokenType: 'Bearer',
      accessTokenExpiresIn: 900,
      user: { id: emp.id, email: emp.email, role: 'employee', isActive: true, level: 'Apprentice' },
    });
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.refreshToken).toMatch(/^[a-f0-9]{24}\.[A-Za-z0-9_-]{43}$/);
    expect(new Date(res.body.refreshTokenExpiresAt as string).getTime()).toBeGreaterThan(
      t.clock().getTime(),
    );
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);

    const session = await AuthSession.findOne().select('+currentTokenHash').lean();
    expect(session?.currentTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(session?.currentTokenHash).not.toBe(res.body.refreshToken);

    // The raw refresh and access tokens must not be anywhere in the database.
    for (const collection of Object.values(mongoose.connection.collections)) {
      const docs = JSON.stringify(await collection.find({}).toArray());
      expect(docs).not.toContain(res.body.refreshToken as string);
      expect(docs).not.toContain(res.body.accessToken as string);
    }
  });

  it('L2: admin login works', async () => {
    const admin = await createAdmin(creds);
    const res = await post({ email: admin.email, password: admin.password });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: 'administrator' });
  });

  it('L3: email matching ignores case and surrounding whitespace', async () => {
    const res = await post({ email: `  ${emp.email.toUpperCase()}  `, password: emp.password });
    expect(res.status).toBe(200);
  });

  it('L4: wrong password and unknown email are indistinguishable, with one bcrypt compare each', async () => {
    const spy = vi.spyOn(bcrypt, 'compare');
    const wrong = await post({ email: emp.email, password: `${emp.password}-wrong` });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    const unknown = await post({ email: 'nobody@example.com', password: emp.password });
    expect(spy).toHaveBeenCalledTimes(1);

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body).toEqual({
      error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' },
    });
    expect(Object.keys(comparableHeaders(wrong.headers)).sort()).toEqual(
      Object.keys(comparableHeaders(unknown.headers)).sort(),
    );
    expect(comparableHeaders(wrong.headers)).toEqual(comparableHeaders(unknown.headers));
  });

  it('L5: a deactivated user with the right password gets the identical 401 and no session', async () => {
    const inactive = await createEmployee(creds, { isActive: false });
    const spy = vi.spyOn(bcrypt, 'compare');
    const res = await post({ email: inactive.email, password: inactive.password });
    const wrong = await post({ email: emp.email, password: 'definitely-not-it' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual(wrong.body);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(await AuthSession.countDocuments()).toBe(0);
    const audit = await AuditLog.findOne({ 'metadata.reason': 'inactive' }).lean();
    expect(audit).toMatchObject({ action: 'auth.login.failed', outcome: 'failure' });
  });

  it.each([
    ['missing fields', {}, 'email'],
    ['missing password', { email: 'a@b.co' }, 'password'],
    ['operator object as password', { email: 'a@b.co', password: { $gt: '' } }, 'password'],
    ['operator object as email', { email: { $ne: null }, password: 'x' }, 'email'],
    ['extra fields', { email: 'a@b.co', password: 'x', isAdmin: true }, ''],
  ])('L6: %s returns 400 VALIDATION_ERROR without echoing input', async (_name, body, path) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const issues = (res.body.error.details as { issues: { location: string; path: string }[] })
      .issues;
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.location === 'body')).toBe(true);
    if (path) expect(issues.map((i) => i.path)).toContain(path);
    expect(JSON.stringify(res.body)).not.toContain('$gt');
  });

  it('L6: a non-JSON content type returns 400', async () => {
    const res = await request(t.app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ email: emp.email, password: emp.password }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('L6: validation errors never contain the submitted password', async () => {
    const secret = randomPassword();
    const res = await post({ email: 'not-an-email', password: secret });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain(secret);
  });

  it('L7: a 1025-character password is a 400; a 100-byte password is the generic 401', async () => {
    const tooLong = await post({ email: emp.email, password: 'x'.repeat(1025) });
    expect(tooLong.status).toBe(400);
    const spy = vi.spyOn(bcrypt, 'compare');
    const long = await post({ email: emp.email, password: 'x'.repeat(100) });
    expect(long.status).toBe(401);
    expect(long.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('L8: success and failure are audited, and no audit entry holds a password or token', async () => {
    const ok = await post({ email: emp.email, password: emp.password });
    await post({ email: emp.email, password: 'wrong-password-here' });
    await post({ email: 'ghost@example.com', password: 'wrong-password-here' });

    const entries = await AuditLog.find().lean();
    const actions = entries.map((e) => e.action).sort();
    expect(actions).toEqual(['auth.login.failed', 'auth.login.failed', 'auth.login.succeeded']);
    const reasons = entries.filter((e) => e.action === 'auth.login.failed').map((e) => e.metadata);
    expect(reasons).toEqual(
      expect.arrayContaining([{ reason: 'bad_credentials' }, { reason: 'unknown_account' }]),
    );

    const dump = JSON.stringify(entries);
    for (const secret of [
      emp.password,
      'wrong-password-here',
      ok.body.accessToken as string,
      ok.body.refreshToken as string,
      'ghost@example.com',
    ]) {
      expect(dump).not.toContain(secret);
    }
    const success = entries.find((e) => e.action === 'auth.login.succeeded');
    expect(success?.actorId?.toString()).toBe(emp.id);
    expect(success?.requestId).toBeTruthy();
  });

  it('L10: there is no self-registration or public user-creation route', async () => {
    for (const path of ['/api/v1/auth/register', '/api/v1/auth/signup', '/api/v1/users']) {
      const res = await request(t.app)
        .post(path)
        .send({ email: 'a@b.co', password: 'x'.repeat(14) });
      expect(res.status).toBe(404);
    }
    expect(await Employee.countDocuments({ email: 'a@b.co' })).toBe(0);
  });

  it('L9: a hash below the configured cost is rehashed on successful login', async () => {
    const strong = await buildTestApp({ bcryptCost: 13 });
    const password = randomPassword();
    const user = await Employee.create({
      name: 'Old Hash',
      email: 'oldhash@example.com',
      passwordHash: await hashPassword(password, 12),
      createdBy: new mongoose.Types.ObjectId(),
    });
    const res = await request(strong.app)
      .post('/api/v1/auth/login')
      .send({ email: 'oldhash@example.com', password });
    expect(res.status).toBe(200);
    const stored = await Employee.findById(user._id).select('+passwordHash');
    expect(getRounds(stored?.passwordHash ?? '')).toBe(13);
    // And the new hash still verifies.
    const again = await request(strong.app)
      .post('/api/v1/auth/login')
      .send({ email: 'oldhash@example.com', password });
    expect(again.status).toBe(200);
    expect(await Administrator.countDocuments()).toBe(0);
  }, 60_000);
});
