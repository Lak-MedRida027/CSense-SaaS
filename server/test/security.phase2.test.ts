/**
 * Phase 2 independent security review: adversarial regression tests.
 *
 * Every test here was written while attacking the Phase 2 auth and security baseline. Tests that
 * expose a real, still-open defect use `it.fails` and name the finding ID from the review report,
 * so the suite stays green until the fix lands. When a fix lands its `it.fails` starts failing:
 * flip it to `it` in the same PR. P2-M1 and P2-L1..L3 are fixed (their IDs stay in the test names
 * as a regression index); the re-review findings P2-L5..L7 at the end of the file are still open.
 */
import { createHmac } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import bcrypt from 'bcrypt';
import express from 'express';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { Types } from 'mongoose';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { audit } from '../src/features/audit/audit.service.js';
import { authenticateBearer } from '../src/features/auth/auth.service.js';
import { getRounds, initDummyHash } from '../src/features/auth/password.js';
import { buildApiRouter } from '../src/http/apiRouter.js';
import { createLogger } from '../src/lib/logger.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { createLimiters } from '../src/middleware/rateLimit.js';
import { Administrator, AuditLog, AuthSession, Employee, User } from '../src/models/index.js';
import { allRoutes } from '../src/routes.js';
import { bootstrapAdmin } from '../src/scripts/bootstrapAdmin.js';
import {
  bearer,
  buildTestApp,
  createAdmin,
  createEmployee,
  loginOk,
  makeCredentials,
  randomPassword,
  uniqueEmail,
  type TestApp,
} from './helpers/fixtures.js';
import { close, listen, rawRequest } from './helpers/rawHttp.js';
import { controllableClock, silentLogger, testConfig } from './helpers/testConfig.js';

let t: TestApp;
let creds: { password: string; hash: string };

beforeAll(async () => {
  t = await buildTestApp();
  creds = await makeCredentials();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const API = '/api/v1';

/** A valid create-user body with a fresh email. */
const newUserBody = (role: 'employee' | 'administrator' = 'employee') => ({
  name: 'Created By Test',
  email: uniqueEmail('new'),
  password: randomPassword(),
  role,
});

const userCount = (): Promise<number> => User.countDocuments();

const sidOf = (refreshToken: string): string => String(refreshToken.split('.')[0]);

// =================================================================================================
describe('SEC-SR: self-registration is impossible', () => {
  it('SR1: no public route creates an account, whatever body is sent', async () => {
    const publicWrites = allRoutes({
      config: t.config,
      clock: t.clock,
      isReady: () => true,
    }).filter((r) => r.access.kind === 'public' && r.method !== 'get');
    expect(publicWrites.length).toBeGreaterThan(0);
    for (const r of publicWrites) {
      for (const body of [
        newUserBody('administrator'),
        { ...newUserBody('administrator'), refreshToken: 'x' },
        { email: uniqueEmail('reg'), password: randomPassword() },
      ]) {
        const res = await request(t.app)[r.method](`${API}${r.path}`).send(body);
        expect(res.status, `${r.method} ${r.path}`).toBeGreaterThanOrEqual(400);
      }
    }
    expect(await userCount()).toBe(0);
  });

  it('SR2: registration-style paths do not exist for any write method', async () => {
    const paths = [
      '/auth/register',
      '/auth/signup',
      '/auth/users',
      '/register',
      '/signup',
      '/users',
      '/accounts',
      '/admin/users/register',
      '/admin/register',
    ];
    for (const path of paths) {
      for (const method of ['post', 'put', 'patch'] as const) {
        const res = await request(t.app)
          [method](`${API}${path}`)
          .send(newUserBody('administrator'));
        expect(res.status, `${method} ${path}`).toBe(404);
      }
    }
    expect(await userCount()).toBe(0);
  });
});

// =================================================================================================
describe('SEC-GR: the access gate and the Express router agree on every request', () => {
  let server: http.Server;
  const BS = String.fromCodePoint(0x5c); // a literal backslash

  beforeAll(async () => {
    server = await listen(t.app);
  });

  afterAll(async () => {
    await close(server);
  });

  /**
   * For each raw path variant: if an administrator's request is served (2xx), the same variant must
   * be denied to anonymous (401) and employee (403) callers. A variant nobody can reach must be a
   * 4xx for everyone. Either way, only the administrator may ever create a user.
   */
  it('GR1: raw path variants of POST /admin/users never widen access', async () => {
    const admin = await createAdmin(creds);
    const employee = await createEmployee(creds);
    const adminToken = (await loginOk(t.app, admin)).accessToken;
    const empToken = (await loginOk(t.app, employee)).accessToken;
    const variants = [
      '/api/v1/admin/users',
      '/api/v1/admin/users/',
      '/API/V1/admin/users',
      '/Api/v1/admin/users',
      '/api/v1/ADMIN/users',
      '/api/v1/admin/Users',
      '/api/v1/admin//users',
      '//api/v1/admin/users',
      '/api/v1//admin/users',
      '/api//v1/admin/users',
      '/api/v1/admin/users//',
      '/api/v1/admin/%75sers',
      '/api/v1/%61dmin/users',
      '/api/v1/admin%2fusers',
      '/api/v1/admin%2Fusers',
      '/api/v1/admin/users%2f',
      '/api/v1/admin/users%00',
      '/api/v1/admin/users%20',
      '/api/v1/admin/users.json',
      '/api/v1/admin/users;x=1',
      '/api/v1/admin/./users',
      '/api/v1/admin/x/../users',
      '/api/v1/auth/../admin/users',
      '/api/v1/auth/%2e%2e/admin/users',
      '/api/v1/auth/%252e%252e/admin/users',
      '/api/v1/admin/users/.',
      `/api/v1/admin${BS}users`,
      `/api/v1${BS}admin${BS}users`,
      `/api/v1/admin/users${BS}`,
      '/api/v1/admin/users?',
      'http://attacker.example/api/v1/admin/users',
      'http://attacker.example//api/v1/admin/users',
    ];

    let created = 0;
    for (const path of variants) {
      const send = (token?: string) =>
        rawRequest(server, {
          method: 'POST',
          path,
          body: JSON.stringify(newUserBody()),
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
      const asAdmin = await send(adminToken);
      const asEmployee = await send(empToken);
      const asAnon = await send();
      if (asAdmin.status >= 200 && asAdmin.status < 300) {
        created += 1;
        expect(asEmployee.status, `employee ${path}`).toBe(403);
        expect(asAnon.status, `anonymous ${path}`).toBe(401);
      } else {
        expect(asAdmin.status, `admin ${path}`).toBeGreaterThanOrEqual(400);
        expect(asEmployee.status, `employee ${path}`).toBeGreaterThanOrEqual(400);
        expect(asAnon.status, `anonymous ${path}`).toBeGreaterThanOrEqual(400);
      }
    }
    // The two seeded accounts plus exactly the admin-created ones.
    expect(await userCount()).toBe(2 + created);
    expect(await User.countDocuments({ createdBy: new Types.ObjectId(employee.id) })).toBe(0);
  });

  it('GR2: authenticated GET routes are enforced for every raw path variant and for HEAD', async () => {
    const variants = [
      '/api/v1/auth/me',
      '/api/v1/auth/me/',
      '/API/V1/auth/me',
      '/api/v1//auth/me',
      '/api/v1/auth/./me',
      '/api/v1/auth/x/../me',
      '/api/v1/auth/%6de',
      `/api/v1/auth${BS}me`,
      'http://attacker.example/api/v1/auth/me',
      '/api/v1/config/features',
      '/api/v1/config/features/',
      '/api/v1/config/./features',
    ];
    for (const path of variants) {
      for (const method of ['GET', 'HEAD']) {
        const res = await rawRequest(server, { method, path });
        expect([401, 404], `${method} ${path}`).toContain(res.status);
      }
    }
  });

  it('GR3: HEAD, OPTIONS, TRACE and method override cannot reach or widen a route', async () => {
    const admin = await createAdmin(creds);
    const employee = await createEmployee(creds);
    const adminToken = (await loginOk(t.app, admin)).accessToken;
    const empToken = (await loginOk(t.app, employee)).accessToken;

    // HEAD is treated as GET by both the gate and the router: same access rules.
    expect((await rawRequest(server, { method: 'HEAD', path: `${API}/auth/me` })).status).toBe(401);
    const headAdmin = await rawRequest(server, {
      method: 'HEAD',
      path: `${API}/admin/users`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(headAdmin.status).toBe(404);

    // OPTIONS: no automatic Allow or CORS answer that would bypass the gate or map the API.
    for (const path of [`${API}/admin/users`, `${API}/auth/login`, `${API}/auth/me`]) {
      const res = await rawRequest(server, { method: 'OPTIONS', path });
      expect(res.status, path).toBe(404);
      expect(res.headers.allow).toBeUndefined();
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }

    for (const method of ['TRACE', 'PUT', 'PATCH', 'DELETE', 'PROPFIND', 'SEARCH']) {
      const res = await rawRequest(server, {
        method,
        path: `${API}/admin/users`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status, method).toBe(404);
    }

    // Method-override headers and query flags are not honoured.
    for (const name of ['X-HTTP-Method-Override', 'X-HTTP-Method', 'X-Method-Override']) {
      for (const token of [adminToken, empToken]) {
        const res = await rawRequest(server, {
          method: 'GET',
          path: `${API}/admin/users`,
          headers: { Authorization: `Bearer ${token}`, [name]: 'POST' },
        });
        expect(res.status, name).toBe(404);
      }
    }
    const viaQuery = await rawRequest(server, {
      method: 'GET',
      path: `${API}/admin/users?_method=POST`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(viaQuery.status).toBe(404);
    const overrideToGet = await rawRequest(server, {
      method: 'POST',
      path: `${API}/auth/me`,
      body: '{}',
      headers: { Authorization: `Bearer ${empToken}`, 'X-HTTP-Method-Override': 'GET' },
    });
    expect(overrideToGet.status).toBe(404);
    expect(await userCount()).toBe(2);
  });

  it('GR4: handlers attached to the API router outside the registry are unreachable for every method', async () => {
    const admin = await createAdmin(creds);
    const { accessToken } = await loginOk(t.app, admin);
    const leak = vi.fn((_req: express.Request, res: express.Response) => {
      res.json({ leaked: true });
    });
    const routes = allRoutes({ config: t.config, clock: t.clock, isReady: () => true });
    const router = buildApiRouter(routes, {
      limiters: createLimiters(t.config.rateLimit),
      authenticate: (h) => authenticateBearer({ config: t.config, clock: t.clock }, h),
    });
    // Same path as a real route with another method, a wildcard, and trailing middleware.
    router.delete('/admin/users', leak);
    router.get('/admin/users', leak);
    router.all('/{*splat}', leak);
    router.use(leak);
    const app = express();
    app.use(express.json());
    app.use('/api/v1', router);
    app.use(errorHandler(silentLogger));

    for (const [method, path] of [
      ['delete', '/admin/users'],
      ['get', '/admin/users'],
      ['get', '/anything'],
      ['post', '/anything/else'],
      ['put', '/auth/login'],
    ] as const) {
      const res = await request(app)
        [method](`${API}${path}`)
        .set(...bearer(accessToken));
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    expect(leak).not.toHaveBeenCalled();
  });
});

// =================================================================================================
describe('SEC-TK: tokens, sessions and IDOR', () => {
  /**
   * Hand-rolled HS256 signer: unlike jose's SignJWT it will emit any header (e.g. an unknown
   * `crit`), which is exactly what an attacker holding the key material could do.
   */
  const forge = (
    claims: Record<string, unknown>,
    opts: { secret?: string; header?: Record<string, unknown> } = {},
  ): Promise<string> => {
    const now = Math.floor(t.clock().getTime() / 1000);
    const b64 = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString('base64url');
    const input = `${b64({ alg: 'HS256', typ: 'JWT', ...opts.header })}.${b64({ iat: now, exp: now + 900, ...claims })}`;
    const sig = createHmac('sha256', opts.secret ?? t.config.jwtAccessSecret)
      .update(input)
      .digest('base64url');
    return Promise.resolve(`${input}.${sig}`);
  };
  const me = (token: string) =>
    request(t.app)
      .get(`${API}/auth/me`)
      .set(...bearer(token));
  const refresh = (refreshToken: string) =>
    request(t.app).post(`${API}/auth/refresh`).send({ refreshToken });
  const logout = (refreshToken: string) =>
    request(t.app).post(`${API}/auth/logout`).send({ refreshToken });

  it('ID1: /auth/me only ever describes the caller; another user cannot be selected', async () => {
    const a = await createEmployee(creds);
    const b = await createEmployee(creds);
    const { accessToken } = await loginOk(t.app, a);
    const get = (path: string) =>
      request(t.app)
        .get(`${API}${path}`)
        .set(...bearer(accessToken));

    const ok = await get('/auth/me');
    expect(ok.status).toBe(200);
    expect(ok.body.id).toBe(a.id);
    expect(JSON.stringify(ok.body)).not.toContain(b.email);

    expect((await get(`/auth/me?userId=${b.id}`)).status).toBe(400);
    expect((await get(`/auth/me?id=${b.id}`)).status).toBe(400);
    expect((await get(`/auth/me/${b.id}`)).status).toBe(404);
    const withBody = await request(t.app)
      .get(`${API}/auth/me`)
      .set(...bearer(accessToken))
      .send({ userId: b.id });
    expect(withBody.status).toBe(400);
    for (const path of [`/users/${b.id}`, `/admin/users/${b.id}`, `/users/${b.id}/progress`]) {
      expect((await get(path)).status, path).toBe(404);
    }
  });

  it('ID2: a refresh token grafted onto the session id of another user is useless and harmless', async () => {
    const a = await createEmployee(creds);
    const b = await createAdmin(creds);
    const la = await loginOk(t.app, a);
    const lb = await loginOk(t.app, b);
    const grafted = `${sidOf(lb.refreshToken)}.${String(la.refreshToken.split('.')[1])}`;
    const before = await AuthSession.findById(sidOf(lb.refreshToken))
      .select('+currentTokenHash')
      .lean();

    expect((await refresh(grafted)).status).toBe(401);
    expect((await logout(grafted)).status).toBe(204);
    expect((await me(grafted)).status).toBe(401);

    const after = await AuthSession.findById(sidOf(lb.refreshToken))
      .select('+currentTokenHash')
      .lean();
    expect(after?.revokedAt).toBeNull();
    expect(after?.currentTokenHash).toBe(before?.currentTokenHash);
    expect(await AuditLog.countDocuments({ action: 'auth.logout' })).toBe(0);
    // The victim keeps working.
    expect((await me(lb.accessToken)).status).toBe(200);
    expect((await refresh(lb.refreshToken)).status).toBe(200);
  });

  it('ID3: an access token signed with the real key cannot bind a user to a foreign session', async () => {
    const a = await createEmployee(creds);
    const b = await createEmployee(creds);
    const sidA = sidOf((await loginOk(t.app, a)).refreshToken);
    const sidB = sidOf((await loginOk(t.app, b)).refreshToken);
    const base = { role: 'employee', iss: 'csense-api', aud: 'csense-desktop', jti: 'x' };
    for (const [sub, sid] of [
      [a.id, sidB],
      [b.id, sidA],
      [b.id, new Types.ObjectId().toHexString()],
    ] as const) {
      expect((await me(await forge({ ...base, sub, sid }))).status, `${sub}/${sid}`).toBe(401);
    }
    // Control: correctly bound claims are accepted.
    expect((await me(await forge({ ...base, sub: a.id, sid: sidA }))).status).toBe(200);
  });

  it('TK1: the access token carries only the documented claims and pins HS256', async () => {
    const emp = await createEmployee(creds);
    const login = await loginOk(t.app, emp);
    expect(decodeProtectedHeader(login.accessToken)).toEqual({ alg: 'HS256', typ: 'JWT' });
    const claims = decodeJwt(login.accessToken);
    expect(Object.keys(claims).sort()).toEqual(
      ['aud', 'exp', 'iat', 'iss', 'jti', 'role', 'sid', 'sub'].sort(),
    );
    const raw = JSON.stringify(claims);
    expect(raw).not.toContain(emp.email);
    expect(raw).not.toContain('Test Employee');
    expect(raw).not.toContain(String(login.refreshToken.split('.')[1]));
    expect(Number(claims.exp) - Number(claims.iat)).toBe(t.config.accessTtlSeconds);
  });

  it('TK2: tokens with confusable claims or headers are rejected even with the real key', async () => {
    const emp = await createEmployee(creds);
    const sid = sidOf((await loginOk(t.app, emp)).refreshToken);
    const good = {
      sub: emp.id,
      sid,
      role: 'employee',
      iss: 'csense-api',
      aud: 'csense-desktop',
      jti: 'j',
    };
    const now = Math.floor(t.clock().getTime() / 1000);
    const attackerKey = 'attacker-controlled-key-material-0123456789';
    const cases: [string, Promise<string>][] = [
      ['aud array', forge({ ...good, aud: ['csense-desktop', 'other'] })],
      ['wrong iss', forge({ ...good, iss: 'csense-desktop' })],
      ['wrong aud', forge({ ...good, aud: 'csense-api' })],
      ['missing sid', forge({ ...good, sid: undefined })],
      ['missing jti', forge({ ...good, jti: undefined })],
      ['nbf in future', forge({ ...good, nbf: now + 3600 })],
      ['role uppercase', forge({ ...good, role: 'EMPLOYEE' })],
      ['sub operator', forge({ ...good, sub: { $ne: null } })],
      ['crit header', forge(good, { header: { crit: ['exp'] } })],
      [
        'embedded jwk',
        forge(good, { secret: attackerKey, header: { jwk: { kty: 'oct', k: 'YQ' } } }),
      ],
      ['kid traversal', forge(good, { secret: attackerKey, header: { kid: '../../dev/null' } })],
      ['refresh secret as key', forge(good, { secret: t.config.refreshTokenSecret })],
    ];
    for (const [name, token] of cases) {
      expect((await me(await token)).status, name).toBe(401);
    }
    // Control: the same builder with good claims is accepted, so the cases above are meaningful.
    expect((await me(await forge(good))).status).toBe(200);
  });

  it('TK3: demotion takes effect on the next request; refresh re-reads the role from the DB', async () => {
    const admin = await createAdmin(creds);
    const login = await loginOk(t.app, admin);
    const create = (token: string) =>
      request(t.app)
        .post(`${API}/admin/users`)
        .set(...bearer(token))
        .send(newUserBody());
    expect((await create(login.accessToken)).status).toBe(201);
    const before = await userCount();

    await User.collection.updateOne(
      { _id: new Types.ObjectId(admin.id) },
      { $set: { role: 'employee' } },
    );
    expect((await create(login.accessToken)).status).toBe(401);

    const refreshed = await refresh(login.refreshToken);
    expect(refreshed.status).toBe(200);
    const newAccess = String(refreshed.body.accessToken);
    expect(decodeJwt(newAccess).role).toBe('employee');
    expect((await create(newAccess)).status).toBe(403);
    expect(await userCount()).toBe(before);
  });

  it('TK4: a burst of concurrent refreshes with one token has one winner and kills the family', async () => {
    const emp = await createEmployee(creds);
    const login = await loginOk(t.app, emp);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => refresh(login.refreshToken)),
    );
    const winners = results.filter((r) => r.status === 200);
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(9);
    const session = await AuthSession.findById(sidOf(login.refreshToken)).lean();
    expect(session?.revokedReason).toBe('reuse_detected');
    const winner = winners[0]?.body as { refreshToken: string; accessToken: string };
    expect((await refresh(winner.refreshToken)).status).toBe(401);
    expect((await me(winner.accessToken)).status).toBe(401);
  });

  it('TK5: a deactivated user loses access, refresh and login at once', async () => {
    const emp = await createEmployee(creds);
    const login = await loginOk(t.app, emp);
    await Employee.updateOne({ _id: emp.id }, { isActive: false });
    expect((await me(login.accessToken)).status).toBe(401);
    const features = await request(t.app)
      .get(`${API}/config/features`)
      .set(...bearer(login.accessToken));
    expect(features.status).toBe(401);
    expect((await refresh(login.refreshToken)).status).toBe(401);
    const relogin = await request(t.app)
      .post(`${API}/auth/login`)
      .send({ email: emp.email, password: emp.password });
    expect(relogin.status).toBe(401);
  });

  // P2-L2 (fixed): a spent refresh token presented to /auth/logout is a replay, exactly as at
  // /auth/refresh: the session is revoked as `reuse_detected` and the critical entry is written.
  it('TK6 [P2-L2]: a spent refresh token presented at logout is recorded as reuse', async () => {
    const emp = await createEmployee(creds);
    const login = await loginOk(t.app, emp);
    expect((await refresh(login.refreshToken)).status).toBe(200);
    expect((await logout(login.refreshToken)).status).toBe(204);
    expect(await AuditLog.countDocuments({ action: 'auth.refresh.reuse_detected' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'auth.logout' })).toBe(0);
    const session = await AuthSession.findById(sidOf(login.refreshToken)).lean();
    expect(session?.revokedReason).toBe('reuse_detected');
  });
});

// =================================================================================================
describe('SEC-EN: no account enumeration', () => {
  const comparable = (headers: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(headers).filter(
        ([k]) => !['date', 'x-request-id', 'etag'].includes(k) && !k.startsWith('ratelimit'),
      ),
    );
  const E_ACUTE = String.fromCodePoint(0xe9); // 2 UTF-8 bytes

  it('EN1: unknown email, wrong password, inactive account and >72-byte password look identical', async () => {
    const active = await createEmployee(creds);
    const inactive = await createEmployee(creds, { isActive: false });
    const spy = vi.spyOn(bcrypt, 'compare');
    const attempt = async (email: string, password: string) => {
      spy.mockClear();
      const res = await request(t.app).post(`${API}/auth/login`).send({ email, password });
      expect(spy, email).toHaveBeenCalledTimes(1);
      return res;
    };
    const responses = [
      await attempt(uniqueEmail('ghost'), randomPassword()),
      await attempt(active.email, `${active.password}-wrong`),
      await attempt(inactive.email, inactive.password),
      await attempt(active.email, active.password + E_ACUTE.repeat(40)),
      await attempt(uniqueEmail('ghost'), E_ACUTE.repeat(60)),
    ];
    const [first, ...rest] = responses;
    expect(first?.status).toBe(401);
    for (const r of rest) {
      expect(r.status).toBe(first?.status);
      expect(r.text).toBe(first?.text);
      expect(comparable(r.headers)).toEqual(comparable(first?.headers ?? {}));
    }
    expect(await AuthSession.countDocuments()).toBe(0);
  });

  it('EN2: the rate-limit headers of a first failure are identical for known and unknown accounts', async () => {
    const emp = await createEmployee(creds);
    const limits = { rateLimit: { loginMaxPerAccountIp: 5, loginMaxPerIp: 50 } };
    const t1 = await buildTestApp(limits);
    const t2 = await buildTestApp(limits);
    const known = await request(t1.app)
      .post(`${API}/auth/login`)
      .send({ email: emp.email, password: 'wrong-wrong-wrong' });
    const unknown = await request(t2.app)
      .post(`${API}/auth/login`)
      .send({ email: uniqueEmail('ghost'), password: 'wrong-wrong-wrong' });
    expect(known.status).toBe(401);
    // `pk` is a hash of each limiter key (the typed email for the per-account limiter), so it
    // differs per email by construction; everything else must match.
    const strip = (v: unknown) => String(v).replace(/pk=:[^:]*:/g, 'pk');
    expect(strip(known.headers.ratelimit)).toBe(strip(unknown.headers.ratelimit));
    expect(strip(known.headers['ratelimit-policy'])).toBe(
      strip(unknown.headers['ratelimit-policy']),
    );
  });

  // P2-L1 (fixed): the dummy hash is created at the configured BCRYPT_COST, but stored hashes keep
  // the cost they were created with until the user next logs in successfully. After a BCRYPT_COST
  // change a failed login for an existing account therefore does more (or less) bcrypt work than
  // for an unknown email. That cannot be removed without rehashing everyone, so every failed login
  // instead waits out the same response-time floor plus jitter. Proven with an injected clock and
  // sleep, not wall-clock time.
  it('EN3 [P2-L1]: after a cost change every failed login waits out the same floor; success does not', async () => {
    const legacy = await createEmployee(creds); // stored at cost 12
    const inactive = await createEmployee(creds, { isActive: false });
    const FLOOR = 1000;
    const JITTER = 7;
    let now = 0;
    const sleeps: number[] = [];
    const timing = {
      now: () => now,
      sleep: (ms: number) => {
        sleeps.push(ms);
        now += ms;
        return Promise.resolve();
      },
      jitter: () => JITTER,
    };
    // The operator raised BCRYPT_COST to 13: stored hashes (12) and the dummy hash (13) now differ.
    const local = await buildTestApp({ bcryptCost: 13, failedLoginMinMs: FLOOR }, { timing });
    try {
      const attempt = async (email: string, password: string) => {
        now = 0;
        sleeps.length = 0;
        const res = await request(local.app).post(`${API}/auth/login`).send({ email, password });
        return { status: res.status, sleeps: [...sleeps], waited: now };
      };
      const failures = [
        await attempt(uniqueEmail('ghost'), 'x-x-x-x-x-x-x'),
        await attempt(legacy.email, 'x-x-x-x-x-x-x'),
        await attempt(inactive.email, inactive.password),
        await attempt(legacy.email, legacy.password + E_ACUTE.repeat(40)),
      ];
      for (const f of failures) {
        expect(f.status).toBe(401);
        expect(f.sleeps).toEqual([FLOOR + JITTER]);
        expect(f.waited).toBe(FLOOR + JITTER);
      }
      // Successful logins are never delayed.
      const ok = await attempt(legacy.email, legacy.password);
      expect(ok.status).toBe(200);
      expect(ok.sleeps).toEqual([]);
    } finally {
      await initDummyHash(12); // the dummy hash is process-global; restore it for later tests
    }
  });
});

// =================================================================================================
describe('SEC-RB: rate-limit bypass attempts', () => {
  const loginTo = (app: TestApp['app'], email: unknown, password: unknown) =>
    request(app).post(`${API}/auth/login`).send({ email, password });
  const TAB = String.fromCodePoint(0x09);
  const NBSP = String.fromCodePoint(0xa0);
  const KELVIN = String.fromCodePoint(0x212a); // KELVIN SIGN lower-cases to ASCII k

  it('RB1: case, whitespace and Unicode look-alike variants of one email share one counter', async () => {
    const local = await buildTestApp({ rateLimit: { loginMaxPerAccountIp: 4 } });
    const victim = await createEmployee(creds, { email: `kate.${uniqueEmail('k')}` });
    const variants = [
      victim.email.toUpperCase(),
      `  ${victim.email}${TAB}`,
      `${NBSP}${victim.email}${NBSP}`,
      victim.email.replace('k', KELVIN),
    ];
    for (const v of variants) {
      expect((await loginTo(local.app, v, 'nope-nope-nope')).status, JSON.stringify(v)).toBe(401);
    }
    expect((await loginTo(local.app, victim.email, victim.password)).status).toBe(429);
  });

  it('RB2: forwarding headers do not change the client key when no proxy is trusted', async () => {
    const local = await buildTestApp({ trustProxyHops: 0, rateLimit: { loginMaxPerIp: 3 } });
    const spoof = [
      ['X-Forwarded-For', '10.1.1.1'],
      ['X-Real-IP', '10.2.2.2'],
      ['Forwarded', 'for=10.3.3.3'],
      ['CF-Connecting-IP', '10.4.4.4'],
      ['True-Client-IP', '10.5.5.5'],
    ] as const;
    const statuses: number[] = [];
    for (const [name, value] of spoof) {
      const res = await loginTo(local.app, uniqueEmail('s'), 'nope-nope-nope').set(name, value);
      statuses.push(res.status);
    }
    expect(statuses).toEqual([401, 401, 401, 429, 429]);
  });

  it('RB3: requests that fail validation still count toward the per-IP login limit', async () => {
    const local = await buildTestApp({ rateLimit: { loginMaxPerIp: 2 } });
    expect((await loginTo(local.app, 'x', undefined)).status).toBe(400);
    expect((await loginTo(local.app, { $ne: null }, 'a')).status).toBe(400);
    expect((await loginTo(local.app, uniqueEmail('v'), 'nope-nope-nope')).status).toBe(429);
  });

  // P2-M1 (fixed): the per-IP limiter runs first, so a request it rejects never reaches an account
  // counter, and the account hard limit is keyed per (email, IP): one host cannot lock a user out
  // from another address.
  it('RB4 [P2-M1]: an attacker already blocked per-IP cannot lock another user out', async () => {
    const local = await buildTestApp({
      trustProxyHops: 1, // simulate two distinct client IPs through X-Forwarded-For
      rateLimit: { loginMaxPerIp: 2, loginMaxPerAccountIp: 3 },
    });
    const victim = await createAdmin(creds);
    const attacker = (email: string) =>
      loginTo(local.app, email, 'nope-nope-nope').set('X-Forwarded-For', '198.51.100.7');
    for (let i = 0; i < 2; i += 1) expect((await attacker(uniqueEmail('a'))).status).toBe(401);
    // The attacker is now IP-blocked: every further attempt is a 429 for them...
    for (let i = 0; i < 3; i += 1) expect((await attacker(victim.email)).status).toBe(429);
    // ...so the victim, from another IP and with the right password, should still get in.
    const res = await loginTo(local.app, victim.email, victim.password).set(
      'X-Forwarded-For',
      '203.0.113.9',
    );
    expect(res.status).toBe(200);
  });

  it('RB5: exhausting the (email, IP) hard limit from one IP does not block the victim elsewhere', async () => {
    const local = await buildTestApp({
      trustProxyHops: 1,
      rateLimit: { loginMaxPerIp: 100, loginMaxPerAccountIp: 3 },
    });
    const victim = await createEmployee(creds);
    const from = (ip: string, password: string) =>
      loginTo(local.app, victim.email, password).set('X-Forwarded-For', ip);
    for (let i = 0; i < 3; i += 1) {
      expect((await from('198.51.100.7', 'nope-nope-nope')).status).toBe(401);
    }
    // The attacker's address is locked for this account, even with the right password...
    expect((await from('198.51.100.7', victim.password)).status).toBe(429);
    // ...but the victim from their own address is not.
    expect((await from('203.0.113.9', victim.password)).status).toBe(200);
  });

  it('RB6: requests that fail validation never count toward any account limit', async () => {
    const local = await buildTestApp({ rateLimit: { loginMaxPerAccountIp: 2 } });
    const victim = await createEmployee(creds);
    for (let i = 0; i < 5; i += 1) {
      // Valid email, invalid body (unknown field, missing password): 400, not a credentials failure.
      const res = await request(local.app)
        .post(`${API}/auth/login`)
        .send({ email: victim.email, extra: true });
      expect(res.status).toBe(400);
    }
    expect((await loginTo(local.app, victim.email, victim.password)).status).toBe(200);
  });

  it('RB7: account-wide failures across IPs raise one audit warning per window and never block', async () => {
    const local = await buildTestApp({
      trustProxyHops: 1,
      rateLimit: { loginMaxPerAccountIp: 100, loginTargetedThreshold: 3 },
    });
    const victim = await createEmployee(creds);
    for (let i = 0; i < 5; i += 1) {
      const res = await loginTo(local.app, victim.email, 'nope-nope-nope').set(
        'X-Forwarded-For',
        `198.51.100.${String(i + 1)}`,
      );
      expect(res.status).toBe(401);
    }
    await vi.waitFor(async () => {
      expect(await AuditLog.countDocuments({ action: 'auth.login.account_targeted' })).toBe(1);
    });
    const entry = await AuditLog.findOne({ action: 'auth.login.account_targeted' }).lean();
    expect(entry).toMatchObject({ severity: 'warning', outcome: 'failure', targetType: 'user' });
    expect(String(entry?.targetId)).toBe(victim.id);
    expect(JSON.stringify(entry)).not.toContain(victim.email);
    // Not a lock: the real user still gets in, and no second warning appears in this window.
    const ok = await loginTo(local.app, victim.email, victim.password).set(
      'X-Forwarded-For',
      '203.0.113.9',
    );
    expect(ok.status).toBe(200);
    expect(await AuditLog.countDocuments({ action: 'auth.login.account_targeted' })).toBe(1);
  });
});

// =================================================================================================
describe('SEC-IN: input validation, injection and payload abuse', () => {
  const operatorValues: unknown[] = [
    { $ne: null },
    { $gt: '' },
    { $regex: '.*' },
    { $where: 'sleep(1000)' },
    ['a@example.com'],
    123,
    true,
    null,
  ];

  it('IN1: operator objects and wrong types in every body field are rejected with 400', async () => {
    const admin = await createAdmin(creds);
    const { accessToken } = await loginOk(t.app, admin);
    const usersBefore = await userCount();
    const sessionsBefore = await AuthSession.countDocuments();
    const targets: [string, Record<string, unknown>, string[]][] = [
      ['/auth/login', { email: admin.email, password: admin.password }, ['email', 'password']],
      ['/auth/refresh', { refreshToken: 'x' }, ['refreshToken']],
      ['/auth/logout', { refreshToken: 'x' }, ['refreshToken']],
      [
        '/admin/users',
        { ...newUserBody(), department: 'Ops' },
        ['name', 'email', 'password', 'role', 'department'],
      ],
    ];
    for (const [path, base, fields] of targets) {
      for (const field of fields) {
        for (const value of operatorValues) {
          const res = await request(t.app)
            .post(`${API}${path}`)
            .set(...bearer(accessToken))
            .send({ ...base, [field]: value });
          expect(res.status, `${path} ${field}=${JSON.stringify(value)}`).toBe(400);
          expect(res.body.error.code).toBe('VALIDATION_ERROR');
          expect(res.text).not.toContain('sleep');
          expect(res.text).not.toContain(admin.password);
        }
      }
    }
    expect(await userCount()).toBe(usersBefore);
    expect(await AuthSession.countDocuments()).toBe(sessionsBefore);
  });

  it('IN2: query strings are rejected on every route, including POST routes', async () => {
    for (const path of [
      '/auth/login?email[$ne]=x',
      '/auth/refresh?a=1',
      '/auth/logout?__proto__[x]=1',
      '/admin/users?role=administrator',
    ]) {
      const res = await request(t.app).post(`${API}${path}`).send({ refreshToken: 'x' });
      expect([400, 401], path).toContain(res.status);
    }
    const admin = await createAdmin(creds);
    const { accessToken } = await loginOk(t.app, admin);
    const res = await request(t.app)
      .post(`${API}/admin/users?role=administrator`)
      .set(...bearer(accessToken))
      .send(newUserBody());
    expect(res.status).toBe(400);
  });

  it('IN3: prototype-pollution payloads are rejected on every body route and pollute nothing', async () => {
    const admin = await createAdmin(creds);
    const { accessToken } = await loginOk(t.app, admin);
    const payloads = [
      '{"__proto__":{"polluted":"yes","role":"administrator"}}',
      '{"constructor":{"prototype":{"polluted":"yes"}}}',
      '{"email":{"__proto__":{"polluted":"yes"}},"password":"x"}',
      '{"refreshToken":"x","__proto__":{"polluted":"yes"}}',
    ];
    for (const path of ['/auth/login', '/auth/refresh', '/auth/logout', '/admin/users']) {
      for (const p of payloads) {
        const res = await request(t.app)
          .post(`${API}${path}`)
          .set(...bearer(accessToken))
          .set('Content-Type', 'application/json')
          .send(p);
        expect(res.status, `${path} ${p}`).toBe(400);
      }
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).role).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('IN4: oversized, compressed, deeply nested and non-object bodies never cause a 500', async () => {
    const post = (body: string | Buffer, headers: Record<string, string> = {}) => {
      const r = request(t.app).post(`${API}/auth/login`).set('Content-Type', 'application/json');
      for (const [k, v] of Object.entries(headers)) r.set(k, v);
      return r.send(body);
    };
    const big = JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(200_000) });
    expect((await post(big)).status).toBe(413);
    // A gzip bomb: 20 MB of JSON that compresses to a few KB. The limit applies after inflation.
    const bomb = gzipSync(
      Buffer.from(`{"email":"a@b.co","password":"${'a'.repeat(20 * 1024 * 1024)}"}`),
    );
    expect(bomb.length).toBeLessThan(100_000);
    // superagent re-encodes Buffer bodies, so the compressed bytes go out over a raw socket.
    const server = await listen(t.app);
    try {
      const send = (encoding: string) =>
        rawRequest(server, {
          method: 'POST',
          path: `${API}/auth/login`,
          body: bomb,
          headers: { 'Content-Encoding': encoding },
        });
      // The limit applies to the inflated size: rejected after 100 KB, not after 20 MB.
      expect((await send('gzip')).status).toBe(413);
      // Mislabelled or unknown encodings are rejected, never crash the request.
      for (const encoding of ['deflate', 'br', 'x-unknown']) {
        const res = await send(encoding);
        expect(res.status, encoding).toBeGreaterThanOrEqual(400);
        expect(res.status, encoding).toBeLessThan(500);
      }
    } finally {
      await close(server);
    }
    const deep = `${'['.repeat(45_000)}${']'.repeat(45_000)}`;
    expect([400, 413]).toContain((await post(deep)).status);
    for (const body of [
      'null',
      '[]',
      '"str"',
      '1',
      'true',
      '{"email":"a@b.co"',
      String.fromCodePoint(0),
    ]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(400);
    }
    const utf16 = await request(t.app)
      .post(`${API}/auth/login`)
      .set('Content-Type', 'application/json; charset=utf-16')
      .send('{}');
    expect(utf16.status).toBeGreaterThanOrEqual(400);
    expect(utf16.status).toBeLessThan(500);
  });

  it('IN5: over-long fields are rejected before any lookup', async () => {
    const long = `${'a'.repeat(250)}@example.com`;
    const login = await request(t.app)
      .post(`${API}/auth/login`)
      .send({ email: long, password: 'x' });
    expect(login.status).toBe(400);
    const refresh = await request(t.app)
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: 'a'.repeat(201) });
    expect(refresh.status).toBe(400);
    const me = await request(t.app)
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${'a'.repeat(3000)}.b.c`);
    expect(me.status).toBe(401);
  });
});

// =================================================================================================
describe('SEC-AL: audit trail and logs', () => {
  it('AL1: no password, token, hash or secret reaches the production-configured log', async () => {
    // The real createLogger (with its redaction config), with its destination captured in memory.
    const logger = createLogger('trace');
    const lines: string[] = [];
    const stream = (logger as unknown as Record<symbol, { write: (s: string) => boolean }>)[
      pino.symbols.streamSym
    ];
    if (!stream) throw new Error('pino stream symbol not found');
    stream.write = (s: string) => {
      lines.push(s);
      return true;
    };
    const config = testConfig();
    const { clock } = controllableClock();
    const app = await createApp({ logger, config, clock });

    const admin = await createAdmin(creds);
    const login = await loginOk(app, admin);
    await request(app)
      .post(`${API}/auth/login`)
      .send({ email: admin.email, password: `${admin.password}X` });
    const r1 = await request(app)
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: login.refreshToken });
    await request(app).post(`${API}/auth/refresh`).send({ refreshToken: login.refreshToken });
    const login2 = await loginOk(app, admin);
    const body = newUserBody();
    const create = (b: object) =>
      request(app)
        .post(`${API}/admin/users`)
        .set(...bearer(login2.accessToken))
        .send(b);
    expect((await create(body)).status).toBe(201);
    expect((await create(body)).status).toBe(409);
    // Force an unhandled 500 on the user-creation path, which logs the error object.
    vi.spyOn(audit, 'record').mockRejectedValueOnce(new Error('audit store down'));
    const body500 = newUserBody();
    expect((await create(body500)).status).toBe(500);
    await request(app).post(`${API}/auth/logout`).send({ refreshToken: login2.refreshToken });

    const text = lines.join('');
    expect(text).toContain('audit store down'); // proves the capture saw the 500 log line
    const secrets = {
      adminPassword: admin.password,
      createdPassword: body.password,
      createdPassword500: body500.password,
      access1: login.accessToken,
      refresh1: login.refreshToken,
      access2: login2.accessToken,
      refresh2: login2.refreshToken,
      rotatedRefresh: String(r1.body.refreshToken),
      jwtSecret: config.jwtAccessSecret,
      refreshSecret: config.refreshTokenSecret,
      storedHash: creds.hash,
    };
    const leaked = Object.entries(secrets)
      .filter(([, v]) => text.includes(v))
      .map(([k]) => k);
    expect(leaked).toEqual([]);
    expect(text).not.toMatch(/[$]2[aby][$]\d\d[$]/);
  });

  it('AL2: the audit trail holds no password, token, hash or email typed for an unknown account', async () => {
    const local = await buildTestApp({ rateLimit: { loginMaxPerAccountIp: 2 } });
    const admin = await createAdmin(creds);
    const ghost = uniqueEmail('ghost');
    const login = await loginOk(local.app, admin);
    const loginAs = (email: string, password: string) =>
      request(local.app).post(`${API}/auth/login`).send({ email, password });
    await loginAs(ghost, 'Typed-Secret-1');
    await loginAs(ghost, 'Typed-Secret-1');
    expect((await loginAs(ghost, 'Typed-Secret-2')).status).toBe(429);
    await loginAs(admin.email, 'Typed-Secret-3');
    const rotated = await request(local.app)
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: login.refreshToken });
    await request(local.app).post(`${API}/auth/refresh`).send({ refreshToken: login.refreshToken });
    const login2 = await loginOk(local.app, admin);
    const body = newUserBody('administrator');
    await request(local.app)
      .post(`${API}/admin/users`)
      .set(...bearer(login2.accessToken))
      .send(body);
    await request(local.app).post(`${API}/auth/logout`).send({ refreshToken: login2.refreshToken });

    const actions = (await AuditLog.find().lean()).map((e) => e.action);
    for (const a of [
      'auth.login.succeeded',
      'auth.login.failed',
      'auth.login.rate_limited',
      'auth.refresh.reuse_detected',
      'user.created',
      'auth.logout',
    ]) {
      expect(actions, a).toContain(a);
    }
    const dump = JSON.stringify(await AuditLog.collection.find({}).toArray());
    const forbidden = {
      ghost,
      typed: 'Typed-Secret',
      adminPassword: admin.password,
      createdPassword: body.password,
      refresh1: login.refreshToken,
      access1: login.accessToken,
      rotated: String(rotated.body.refreshToken),
      access2: login2.accessToken,
      hash: creds.hash,
    };
    const found = Object.entries(forbidden)
      .filter(([, v]) => dump.includes(v))
      .map(([k]) => k);
    expect(found).toEqual([]);
    expect(dump).not.toMatch(/[$]2[aby][$]|[a-f0-9]{64}/);
  });

  it('AL3: additional mutation paths on AuditLog are blocked', async () => {
    const doc = await AuditLog.create({
      action: 'auth.logout',
      outcome: 'success',
      metadata: { n: 1 },
    });
    const id = doc._id;
    const original = JSON.stringify(await AuditLog.collection.findOne({ _id: id }));
    const load = async () => {
      const d = await AuditLog.findById(id);
      if (!d) throw new Error('missing');
      return d;
    };
    const ops: [string, () => Promise<unknown>][] = [
      [
        'bulkSave',
        async () => {
          const d = await load();
          d.outcome = 'failure';
          return AuditLog.bulkSave([d]);
        },
      ],
      [
        'hydrate then save',
        async () => {
          const d = AuditLog.hydrate(await AuditLog.collection.findOne({ _id: id }));
          d.set('outcome', 'failure');
          return d.save();
        },
      ],
      [
        'isNew forced then save',
        async () => {
          const d = await load();
          d.isNew = true;
          d.outcome = 'failure';
          return d.save();
        },
      ],
      [
        'query chain updateOne',
        () => AuditLog.find({ _id: id }).updateOne({}, { outcome: 'failure' }).exec(),
      ],
      ['query chain deleteOne', () => AuditLog.where({ _id: id }).deleteOne().exec()],
      [
        'upsert',
        () =>
          AuditLog.findOneAndUpdate({ _id: id }, { outcome: 'failure' }, { upsert: true }).exec(),
      ],
      [
        'pipeline update',
        () =>
          AuditLog.updateOne({ _id: id }, [{ $set: { outcome: 'failure' } }], {
            updatePipeline: true,
          }).exec(),
      ],
      [
        'bulkWrite replace',
        () =>
          AuditLog.bulkWrite([
            {
              replaceOne: {
                filter: { _id: id },
                replacement: {
                  action: 'auth.logout',
                  outcome: 'failure',
                  severity: 'info',
                  metadata: {},
                  createdAt: new Date(),
                },
              },
            },
          ]),
      ],
      ['bulkWrite deleteMany', () => AuditLog.bulkWrite([{ deleteMany: { filter: {} } }])],
    ];
    for (const [name, op] of ops) {
      const err: unknown = await Promise.resolve()
        .then(op)
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(err, `${name} must be rejected`).not.toBeNull();
      // Blocked by the model hooks, or (forced isNew) refused by the unique _id index.
      expect(['AUDIT_LOG_IMMUTABLE', 11000], name).toContain((err as { code?: unknown }).code);
    }
    expect(await AuditLog.countDocuments()).toBe(1);
    expect(JSON.stringify(await AuditLog.collection.findOne({ _id: id }))).toBe(original);
  });
});

// =================================================================================================
describe('SEC-BS: bootstrap administrator script', () => {
  const input = (overrides: Record<string, string> = {}) => ({
    BOOTSTRAP_ADMIN_EMAIL: uniqueEmail('boot'),
    BOOTSTRAP_ADMIN_NAME: 'Bootstrap Admin',
    BOOTSTRAP_ADMIN_PASSWORD: randomPassword(),
    ...overrides,
  });
  const rawUser = (id: string) => User.collection.findOne({ _id: new Types.ObjectId(id) });

  it('BS1: an existing (even deactivated) administrator cannot be reset or replaced', async () => {
    const admin = await createAdmin(creds);
    await Administrator.updateOne({ _id: admin.id }, { isActive: false });
    const before = await rawUser(admin.id);
    for (const env of [
      input({ BOOTSTRAP_ADMIN_EMAIL: admin.email }),
      input({ BOOTSTRAP_ADMIN_EMAIL: admin.email.toUpperCase() }),
      input(),
    ]) {
      expect(await bootstrapAdmin(env, { bcryptCost: 12 })).toBe('skipped');
    }
    expect(await rawUser(admin.id)).toEqual(before);
    expect(await Administrator.countDocuments()).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'admin.bootstrapped' })).toBe(0);
  });

  it('BS2: an employee account cannot be taken over by bootstrapping its email', async () => {
    const emp = await createEmployee(creds);
    const before = await rawUser(emp.id);
    await expect(
      bootstrapAdmin(input({ BOOTSTRAP_ADMIN_EMAIL: emp.email }), { bcryptCost: 12 }),
    ).rejects.toThrow();
    expect(await rawUser(emp.id)).toEqual(before);
    expect(await Administrator.countDocuments()).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'admin.bootstrapped' })).toBe(0);
  });

  // P2-L3 (fixed): the existence check and the insert are not atomic, so correctness comes from a
  // unique partial index on `createdBy: null` (User model); the loser of the race is 'skipped'.
  it('BS3 [P2-L3]: concurrent bootstrap runs create exactly one administrator', async () => {
    await User.init(); // make sure the unique partial index exists before racing
    const results = await Promise.allSettled([
      bootstrapAdmin(input(), { bcryptCost: 12 }),
      bootstrapAdmin(input(), { bcryptCost: 12 }),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const values = results.map((r) => (r.status === 'fulfilled' ? r.value : null)).sort();
    expect(values).toEqual(['created', 'skipped']);
    expect(await Administrator.countDocuments({ createdBy: null })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'admin.bootstrapped' })).toBe(1);
  });

  it('BS4: bootstrap and env errors name keys but never echo secret values', async () => {
    const weak = 'Short-Pw-1';
    let bootstrapMessage = '';
    try {
      await bootstrapAdmin(input({ BOOTSTRAP_ADMIN_PASSWORD: weak }), { bcryptCost: 12 });
    } catch (e) {
      bootstrapMessage = e instanceof Error ? e.message : String(e);
    }
    expect(bootstrapMessage).toContain('BOOTSTRAP_ADMIN_PASSWORD');
    expect(bootstrapMessage).not.toContain(weak);

    const marker = 'MARKER-shh-this-is-secret';
    const longMarker = `${marker}-${'x'.repeat(20)}`;
    const okRefresh = 'r'.repeat(40);
    const cases: Record<string, string>[] = [
      { JWT_ACCESS_SECRET: marker.slice(0, 20), REFRESH_TOKEN_SECRET: okRefresh },
      { JWT_ACCESS_SECRET: longMarker, REFRESH_TOKEN_SECRET: longMarker },
      { JWT_ACCESS_SECRET: longMarker, REFRESH_TOKEN_SECRET: okRefresh, BCRYPT_COST: marker },
      { JWT_ACCESS_SECRET: longMarker, REFRESH_TOKEN_SECRET: okRefresh, JWT_ACCESS_TTL: marker },
      {
        JWT_ACCESS_SECRET: longMarker,
        REFRESH_TOKEN_SECRET: okRefresh,
        MONGODB_URI: `http://u:${marker}@h`,
      },
    ];
    for (const extra of cases) {
      let message = '';
      try {
        loadEnv({ MONGODB_URI: 'mongodb://127.0.0.1/x', ...extra });
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      expect(message, JSON.stringify(Object.keys(extra))).not.toBe('');
      expect(message).not.toContain('MARKER');
      expect(message).not.toContain('shh');
    }
  });
});

// =================================================================================================
// Re-review of the Phase 2 fixes (P2-M1, P2-L1..L4, I1, I7). Same conventions: `it.fails` marks an
// open finding and names its ID.
describe('SEC-RR: re-review of the fixes', () => {
  /** Sends a login over a raw socket and destroys it after `abortAfterMs`, before any response. */
  function abortedLogin(
    server: http.Server,
    body: object,
    headers: Record<string, string>,
    abortAfterMs: number,
  ): Promise<'aborted' | 'answered'> {
    const { port } = server.address() as AddressInfo;
    const payload = JSON.stringify(body);
    return new Promise((resolve) => {
      const req = http.request({
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: `${API}/auth/login`,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(payload)),
          ...headers,
        },
      });
      let answered = false;
      req.on('response', (res) => {
        answered = true;
        res.resume();
        resolve('answered');
      });
      req.on('error', () => undefined);
      req.end(payload);
      setTimeout(() => {
        if (!answered) {
          req.destroy();
          resolve('aborted');
        }
      }, abortAfterMs);
    });
  }

  const loginTo = (app: TestApp['app'], email: string, password: string, ip: string) =>
    request(app).post(`${API}/auth/login`).set('X-Forwarded-For', ip).send({ email, password });

  it('RR1: aborting the connection never refunds a guess (the reservation stays counted)', async () => {
    const local = await buildTestApp({
      trustProxyHops: 1,
      failedLoginMinMs: 400,
      rateLimit: { loginMaxPerAccountIp: 3 },
    });
    const victim = await createEmployee(creds);
    const server = await listen(local.app);
    try {
      for (let i = 0; i < 3; i += 1) {
        const outcome = await abortedLogin(
          server,
          { email: victim.email, password: 'nope-nope-nope' },
          { 'X-Forwarded-For': '198.51.100.7' },
          100,
        );
        expect(outcome).toBe('aborted');
      }
      await vi.waitFor(
        async () => {
          expect(await AuditLog.countDocuments({ action: 'auth.login.failed' })).toBe(3);
        },
        { timeout: 5000 },
      );
      // The three aborted guesses still count: the fourth from that address is refused.
      const fourth = await loginTo(local.app, victim.email, victim.password, '198.51.100.7');
      expect(fourth.status).toBe(429);
    } finally {
      await close(server);
    }
  });

  // P2-L7: the account-wide signal (auth.login.account_targeted) is only fed from the response
  // finish event. A client that drops the connection before the answer (the failure floor makes
  // this trivial: a success arrives in about 250 ms, a failure only after the floor) never lets
  // finish fire, so a distributed guesser is never flagged although every guess was evaluated.
  it('RR2 [P2-L7]: guesses whose connection is dropped still raise the account-wide warning', async () => {
    const local = await buildTestApp({
      trustProxyHops: 1,
      failedLoginMinMs: 400,
      rateLimit: { loginMaxPerAccountIp: 100, loginTargetedThreshold: 3 },
    });
    const victim = await createEmployee(creds);
    const server = await listen(local.app);
    try {
      for (let i = 0; i < 4; i += 1) {
        await abortedLogin(
          server,
          { email: victim.email, password: 'nope-nope-nope' },
          { 'X-Forwarded-For': `198.51.100.${String(i + 1)}` },
          100,
        );
      }
      // Every guess was evaluated and audited as a failed login...
      await vi.waitFor(
        async () => {
          expect(await AuditLog.countDocuments({ action: 'auth.login.failed' })).toBe(4);
        },
        { timeout: 5000 },
      );
      await new Promise((r) => setTimeout(r, 800)); // let the floors and any finish handlers run
      // ...so the account-wide threshold (3) was crossed and must have been flagged.
      expect(await AuditLog.countDocuments({ action: 'auth.login.account_targeted' })).toBe(1);
    } finally {
      await close(server);
    }
  });

  // P2-L6: the failure floor is a fixed duration measured from the start of the request. Whenever
  // bcrypt work plus threadpool queueing exceeds it (BCRYPT_COST 15 alone takes about 1.9 s on the
  // dev machine; 16 concurrent cost-12 compares take about 1.1 s on the default 4-thread pool, the
  // normal morning start-up burst for a workstation gate), the floor stops masking and the P2-L1
  // difference between existing and unknown accounts reappears.
  it('RR3 [P2-L6]: existing and unknown accounts take the same time when bcrypt work exceeds the floor', async () => {
    const legacy = await createEmployee(creds); // stored at cost 12
    const QUEUE_MS = 600; // simulated libuv threadpool wait under load
    const msForRounds = (rounds: number) => 230 * Math.pow(2, rounds - 12); // cost 12 ~ 230 ms
    let now = 0;
    const timing = {
      now: () => now,
      sleep: (ms: number) => {
        now += ms;
        return Promise.resolve();
      },
      jitter: () => 0,
    };
    const realCompare = bcrypt.compare.bind(bcrypt) as (d: string, h: string) => Promise<boolean>;
    const local = await buildTestApp({ bcryptCost: 13, failedLoginMinMs: 1000 }, { timing });
    try {
      vi.spyOn(bcrypt, 'compare').mockImplementation((async (data: string, hash: string) => {
        now += QUEUE_MS + msForRounds(getRounds(hash));
        return realCompare(data, hash);
      }) as never);
      const elapsed = async (email: string) => {
        now = 0;
        const res = await request(local.app)
          .post(`${API}/auth/login`)
          .send({ email, password: 'x-x-x-x-x-x-x' });
        expect(res.status).toBe(401);
        return now;
      };
      // Warm-up: the floor adapts to the largest recent failed-login work (P2-L6), so the first
      // slow failures after start-up may precede adaptation. Measure once it has seen the load.
      await elapsed(uniqueEmail('ghost'));
      await elapsed(uniqueEmail('ghost'));
      const unknown = await elapsed(uniqueEmail('ghost'));
      const known = await elapsed(legacy.email);
      expect(known).toBe(unknown);
    } finally {
      await initDummyHash(12);
    }
  });

  it('RR4: known and unknown emails stay indistinguishable across the new limits', async () => {
    const run = async (email: string) => {
      const local = await buildTestApp({
        rateLimit: { loginMaxPerAccountIp: 2, loginTargetedThreshold: 2 },
      });
      const out: { status: number; text: string; headers: string[]; retry: boolean }[] = [];
      for (let i = 0; i < 4; i += 1) {
        const res = await request(local.app)
          .post(`${API}/auth/login`)
          .send({ email, password: 'nope-nope-nope' });
        out.push({
          status: res.status,
          text: res.text,
          headers: Object.keys(res.headers)
            .filter((k) => !['date', 'x-request-id', 'etag'].includes(k))
            .sort(),
          retry: res.headers['retry-after'] !== undefined,
        });
      }
      return out;
    };
    const emp = await createEmployee(creds);
    const known = await run(emp.email);
    const unknown = await run(uniqueEmail('ghost'));
    expect(known.map((r) => r.status)).toEqual([401, 401, 429, 429]);
    expect(unknown).toEqual(known);
  });

  it('RR5: the createdBy partial index never blocks admin-created accounts', async () => {
    await User.createIndexes();
    const bootEmail = uniqueEmail('boot');
    const bootPassword = randomPassword();
    const result = await bootstrapAdmin(
      {
        BOOTSTRAP_ADMIN_EMAIL: bootEmail,
        BOOTSTRAP_ADMIN_NAME: 'Boot',
        BOOTSTRAP_ADMIN_PASSWORD: bootPassword,
      },
      { bcryptCost: 12 },
    );
    expect(result).toBe('created');
    const boot = await loginOk(t.app, { email: bootEmail, password: bootPassword });
    const second = newUserBody('administrator');
    for (const body of [newUserBody(), newUserBody(), second]) {
      const res = await request(t.app)
        .post(`${API}/admin/users`)
        .set(...bearer(boot.accessToken))
        .send(body);
      expect(res.status).toBe(201);
    }
    const next = await loginOk(t.app, second);
    const res = await request(t.app)
      .post(`${API}/admin/users`)
      .set(...bearer(next.accessToken))
      .send(newUserBody());
    expect(res.status).toBe(201);
    expect(await User.countDocuments({ createdBy: null })).toBe(1);
    expect(await userCount()).toBe(5);
  });

  it('RR7 [P2-L5]: bootstrap refuses to run when the single-admin index cannot be built', async () => {
    await User.collection.dropIndexes();
    try {
      const orphan = (email: string) => ({
        name: 'Orphan',
        email,
        passwordHash: creds.hash,
        role: 'employee',
        isActive: true,
        createdBy: null,
      });
      await User.collection.insertMany([orphan(uniqueEmail('o')), orphan(uniqueEmail('o'))]);
      const before = await userCount();
      await expect(
        bootstrapAdmin(
          {
            BOOTSTRAP_ADMIN_EMAIL: uniqueEmail('boot'),
            BOOTSTRAP_ADMIN_NAME: 'Boot',
            BOOTSTRAP_ADMIN_PASSWORD: randomPassword(),
          },
          { bcryptCost: 12 },
        ),
      ).rejects.toThrow(/createdBy_1/);
      expect(await userCount()).toBe(before);
      expect(await Administrator.countDocuments()).toBe(0);
    } finally {
      await User.collection.deleteMany({});
      await User.createIndexes();
    }
  });

  // P2-L5: the race fix relies entirely on the unique partial index, but bootstrapAdmin never
  // ensures that index exists. It exists only if Mongoose autoIndex built it in time and the build
  // did not fail (autoIndex is commonly switched off in production, and a failed build on existing
  // duplicates is only emitted as a model event). Without it, concurrent runs still create two.
  it('RR6 [P2-L5]: concurrent bootstrap is race-free even when the index has not been built', async () => {
    await User.collection.dropIndexes();
    try {
      const run = () =>
        bootstrapAdmin(
          {
            BOOTSTRAP_ADMIN_EMAIL: uniqueEmail('boot'),
            BOOTSTRAP_ADMIN_NAME: 'Boot',
            BOOTSTRAP_ADMIN_PASSWORD: randomPassword(),
          },
          { bcryptCost: 12 },
        );
      await Promise.allSettled([run(), run()]);
      expect(await Administrator.countDocuments({ createdBy: null })).toBe(1);
    } finally {
      await User.collection.deleteMany({});
      await User.createIndexes();
    }
  });
});
