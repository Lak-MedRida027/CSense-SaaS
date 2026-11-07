import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { audit } from '../src/features/audit/audit.service.js';
import { getRounds } from '../src/features/auth/password.js';
import { AuditLog, Employee, User } from '../src/models/index.js';
import {
  bearer,
  buildTestApp,
  createAdmin,
  createEmployee,
  loginOk,
  makeCredentials,
  randomPassword,
  uniqueEmail,
  type SeedUser,
  type TestApp,
} from './helpers/fixtures.js';

let t: TestApp;
let creds: { password: string; hash: string };
let admin: SeedUser;
let adminToken: string;

beforeAll(async () => {
  t = await buildTestApp();
  creds = await makeCredentials();
});

beforeEach(async () => {
  admin = await createAdmin(creds);
  adminToken = (await loginOk(t.app, admin)).accessToken;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const create = (token: string | null, body: unknown) => {
  const r = request(t.app).post('/api/v1/admin/users');
  return (token === null ? r : r.set(...bearer(token))).send(body as object);
};

const validBody = (overrides: Record<string, unknown> = {}) => ({
  name: 'New Person',
  email: uniqueEmail('new'),
  password: randomPassword(),
  role: 'employee',
  ...overrides,
});

describe('POST /admin/users', () => {
  it('U1: an admin creates an employee who can then log in', async () => {
    const body = validBody({ department: 'Finance' });
    const res = await create(adminToken, body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'New Person',
      email: body.email,
      role: 'employee',
      department: 'Finance',
      isActive: true,
      createdBy: admin.id,
      totalXP: 0,
      level: 'Apprentice',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password|\$2[aby]\$/);

    const stored = await User.findOne({ email: body.email }).select('+passwordHash');
    expect(getRounds(stored?.passwordHash ?? '')).toBeGreaterThanOrEqual(12);
    expect(stored?.passwordHash).not.toBe(body.password);
    expect(stored?.createdBy?.toString()).toBe(admin.id);

    const loggedIn = await request(t.app)
      .post('/api/v1/auth/login')
      .send({ email: body.email, password: body.password });
    expect(loggedIn.status).toBe(200);
  });

  it('U2: an admin can create another administrator', async () => {
    const res = await create(adminToken, validBody({ role: 'administrator' }));
    expect(res.status).toBe(201);
    expect(res.body.role).toBe('administrator');
    expect(res.body).not.toHaveProperty('totalXP');
    const entry = await AuditLog.findOne({ action: 'user.created' }).lean();
    expect(entry?.severity).toBe('warning');
  });

  it('U3: a duplicate email in a different case returns 409 CONFLICT', async () => {
    const body = validBody();
    expect((await create(adminToken, body)).status).toBe(201);
    const dup = await create(adminToken, { ...body, email: body.email.toUpperCase() });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');
    expect(await User.countDocuments({ email: body.email })).toBe(1);
  });

  it.each([
    ['password under 12', { password: 'short-pw-1' }],
    ['password over 72 bytes', { password: 'x'.repeat(73) }],
    ['multibyte password over 72 bytes', { password: 'é'.repeat(40) }],
    ['bad email', { email: 'not-an-email' }],
    ['role superadmin', { role: 'superadmin' }],
    ['missing role', { role: undefined }],
    ['missing name', { name: undefined }],
    ['smuggled isActive', { isActive: false }],
    ['smuggled createdBy', { createdBy: '0'.repeat(24) }],
    ['smuggled totalXP', { totalXP: 99999 }],
    ['smuggled passwordHash', { passwordHash: 'x' }],
    ['operator object as email', { email: { $ne: null } }],
  ])('U4: %s returns 400 and creates nothing', async (_n, overrides) => {
    const before = await User.countDocuments();
    const res = await create(adminToken, validBody(overrides));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await User.countDocuments()).toBe(before);
  });

  it('U4: a __proto__ payload returns 400 and creates nothing', async () => {
    const before = await User.countDocuments();
    const raw = JSON.stringify(validBody()).replace('{', '{"__proto__":{"role":"administrator"},');
    const res = await request(t.app)
      .post('/api/v1/admin/users')
      .set(...bearer(adminToken))
      .set('Content-Type', 'application/json')
      .send(raw);
    expect(res.status).toBe(400);
    expect(await User.countDocuments()).toBe(before);
  });

  it('U5: an employee token gets 403 and creates nothing; no or bad token gets 401', async () => {
    const employee = await createEmployee(creds);
    const empToken = (await loginOk(t.app, employee)).accessToken;
    const body = validBody();
    const forbidden = await create(empToken, body);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
    expect(await Employee.countDocuments({ email: body.email })).toBe(0);

    expect((await create(null, body)).status).toBe(401);
    expect((await create('aaa.bbb.ccc', body)).status).toBe(401);
    expect(await User.countDocuments({ email: body.email })).toBe(0);
  });

  it('U6: user.created is audited with actor and target, and no password', async () => {
    const body = validBody();
    const res = await create(adminToken, body);
    const entry = await AuditLog.findOne({ action: 'user.created' }).lean();
    expect(entry).toMatchObject({ outcome: 'success', severity: 'info', targetType: 'user' });
    expect(entry?.actorId?.toString()).toBe(admin.id);
    expect(entry?.actorRole).toBe('administrator');
    expect(entry?.targetId?.toString()).toBe(res.body.id);
    expect(JSON.stringify(entry)).not.toContain(body.password);
  });

  it('U7: a failing audit write returns 500 and leaves no user behind', async () => {
    const body = validBody();
    vi.spyOn(audit, 'record').mockRejectedValueOnce(new Error('audit store down'));
    const res = await create(adminToken, body);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('audit store down');
    expect(await User.countDocuments({ email: body.email })).toBe(0);
  });
});
