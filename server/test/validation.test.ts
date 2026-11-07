import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

describe('validation', () => {
  it('V1: issue details carry only location, path and message', async () => {
    const secret = 'super-secret-value-123';
    const res = await request(t.app)
      .post('/api/v1/auth/login')
      .send({ email: secret, password: secret, extra: secret });
    expect(res.status).toBe(400);
    const issues = (res.body.error.details as { issues: Record<string, unknown>[] }).issues;
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(Object.keys(issue).sort()).toEqual(['location', 'message', 'path']);
    }
    expect(Object.keys(res.body.error.details as object)).toEqual(['issues']);
    expect(JSON.stringify(res.body)).not.toContain(secret);
  });

  it('V2: operator-style query strings are rejected, not interpreted', async () => {
    const { accessToken } = await loginOk(t.app, emp);
    for (const qs of ['?email[$ne]=', '?role=administrator', '?$where=1', '?a=1&a=2']) {
      const res = await request(t.app)
        .get(`/api/v1/auth/me${qs}`)
        .set(...bearer(accessToken));
      expect(res.status, qs).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('V2: a request body on a GET route must be empty', async () => {
    const { accessToken } = await loginOk(t.app, emp);
    const res = await request(t.app)
      .get('/api/v1/auth/me')
      .set(...bearer(accessToken))
      .send({ role: 'administrator' });
    expect(res.status).toBe(400);
  });

  it('V3: a prototype-pollution payload has no lasting effect', async () => {
    const payloads = [
      '{"__proto__":{"role":"administrator"},"email":"a@b.co","password":"x"}',
      '{"email":"a@b.co","password":"x","constructor":{"prototype":{"role":"administrator"}}}',
      '{"email":"a@b.co","password":"x","__proto__":{"isAdmin":true}}',
    ];
    for (const raw of payloads) {
      const res = await request(t.app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send(raw);
      expect(res.status).toBe(400);
    }
    const probe = {} as Record<string, unknown>;
    expect(probe.role).toBeUndefined();
    expect(probe.isAdmin).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('role');

    // And a later normal login still yields an employee, not an administrator.
    const body = await loginOk(t.app, emp);
    expect(body.user.role).toBe('employee');
  });

  it('rejects malformed JSON and oversized bodies with the shared envelope', async () => {
    const bad = await request(t.app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_JSON');

    const big = await request(t.app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.co', password: 'x', pad: 'y'.repeat(200_000) }));
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
