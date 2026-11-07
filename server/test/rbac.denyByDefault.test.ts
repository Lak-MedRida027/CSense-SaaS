import express from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { authenticateBearer } from '../src/features/auth/auth.service.js';
import { buildApiRouter } from '../src/http/apiRouter.js';
import { PUBLIC, defineRoute, type Access, type RouteDef } from '../src/http/routeRegistry.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { createLimiters } from '../src/middleware/rateLimit.js';
import { allRoutes } from '../src/routes.js';
import {
  bearer,
  buildTestApp,
  createAdmin,
  createEmployee,
  loginOk,
  makeCredentials,
  type TestApp,
} from './helpers/fixtures.js';
import { close, listen, rawRequest } from './helpers/rawHttp.js';
import { silentLogger } from './helpers/testConfig.js';

let t: TestApp;
let creds: { password: string; hash: string };
let routes: RouteDef[];

const label = (a: Access): string => (a.kind === 'role' ? `role:${a.roles.join('|')}` : a.kind);
const dummyId = new Types.ObjectId().toHexString();
const concrete = (path: string): string => path.replace(/:[A-Za-z]+/g, dummyId);

beforeAll(async () => {
  t = await buildTestApp();
  creds = await makeCredentials();
  routes = allRoutes({ config: t.config, clock: t.clock, isReady: () => true });
});

describe('route table', () => {
  it('B1: the route inventory matches the reviewed (method, path, access) table', () => {
    const inventory = routes
      .map((r) => `${r.method.toUpperCase()} ${r.path} ${label(r.access)}`)
      .sort();
    expect(inventory).toEqual(
      [
        'GET /health public',
        'GET /health/ready public',
        'POST /auth/login public',
        'POST /auth/refresh public',
        'POST /auth/logout public',
        'GET /auth/me authenticated',
        'GET /config/features authenticated',
        'POST /admin/users role:administrator',
        // Phase 3: the learning engine. Every route is employee-only.
        'GET /modules role:employee',
        'GET /modules/:moduleId role:employee',
        'POST /modules/:moduleId/start role:employee',
        'POST /modules/:moduleId/exercises/:exerciseId/answers role:employee',
        'POST /modules/:moduleId/content/complete role:employee',
        'GET /modules/:moduleId/quiz role:employee',
        'POST /modules/:moduleId/quiz/sessions role:employee',
        'POST /modules/:moduleId/quiz/sessions/:sessionId/abandon role:employee',
        'POST /modules/:moduleId/quiz/attempts role:employee',
        'GET /final-test role:employee',
        'POST /final-test/sessions role:employee',
        'POST /final-test/sessions/:sessionId/abandon role:employee',
        'POST /final-test/attempts role:employee',
        'GET /me/attempts role:employee',
        'GET /me/attempts/:attemptId role:employee',
      ].sort(),
    );
  });

  it('B2: every non-public route returns 401 without a token', async () => {
    const protectedRoutes = routes.filter((r) => r.access.kind !== 'public');
    expect(protectedRoutes.length).toBeGreaterThan(0);
    for (const r of protectedRoutes) {
      const res = await request(t.app)
        [r.method](`/api/v1${concrete(r.path)}`)
        .send({});
      expect(res.status, `${r.method} ${r.path}`).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Bearer');
    }
  });

  it('B3: every administrator-only route returns 403 for an employee token', async () => {
    const employee = await createEmployee(creds);
    const { accessToken } = await loginOk(t.app, employee);
    // Only routes that are closed to employees: employee-only routes are checked by B7.
    const adminRoutes = routes.filter(
      (r) =>
        r.access.kind === 'role' &&
        r.access.roles.includes('administrator') &&
        !r.access.roles.includes('employee'),
    );
    expect(adminRoutes.length).toBeGreaterThan(0);
    for (const r of adminRoutes) {
      const res = await request(t.app)
        [r.method](`/api/v1${concrete(r.path)}`)
        .set(...bearer(accessToken))
        .send({});
      expect(res.status, `${r.method} ${r.path}`).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('B7: every employee-only route returns 403 for an administrator token', async () => {
    const admin = await createAdmin(creds);
    const { accessToken } = await loginOk(t.app, admin);
    const employeeRoutes = routes.filter(
      (r) =>
        r.access.kind === 'role' &&
        r.access.roles.includes('employee') &&
        !r.access.roles.includes('administrator'),
    );
    expect(employeeRoutes.length).toBeGreaterThanOrEqual(15);
    for (const r of employeeRoutes) {
      const res = await request(t.app)
        [r.method](`/api/v1${concrete(r.path)}`)
        .set(...bearer(accessToken))
        .send({});
      expect(res.status, `${r.method} ${r.path}`).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('B3: role matching is exact, so an administrator is denied employee-only routes', async () => {
    const spy = vi.fn(() => ({ ok: true }));
    const extra = defineRoute({
      method: 'get',
      path: '/employee-only',
      access: { kind: 'role', roles: ['employee'] },
      handler: spy,
    });
    const local = await buildTestApp({}, { routes: [extra] });
    const admin = await createAdmin(creds);
    const { accessToken } = await loginOk(local.app, admin);
    const res = await request(local.app)
      .get('/api/v1/employee-only')
      .set(...bearer(accessToken));
    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it('B4: a raw handler attached outside the registry returns 404 even with an admin token', async () => {
    const admin = await createAdmin(creds);
    const { accessToken } = await loginOk(t.app, admin);
    const rawHandler = vi.fn((_req: unknown, res: express.Response) => {
      res.json({ leaked: true });
    });

    const router = buildApiRouter(routes, {
      limiters: createLimiters(t.config.rateLimit),
      authenticate: (header) => authenticateBearer({ config: t.config, clock: t.clock }, header),
    });
    router.get('/raw', rawHandler);
    const app = express();
    app.use('/api/v1', router);
    app.use(errorHandler(silentLogger));

    const res = await request(app)
      .get('/api/v1/raw')
      .set(...bearer(accessToken));
    expect(res.status).toBe(404);
    expect(rawHandler).not.toHaveBeenCalled();
    // A registered route still works through the same router.
    expect((await request(app).get('/api/v1/health')).status).toBe(200);
  });

  it('B5: an app with an unannotated definition fails to construct', async () => {
    const unannotated = { method: 'get', path: '/open', handler: () => 'x' } as unknown as RouteDef;
    await expect(buildTestApp({}, { routes: [unannotated] })).rejects.toThrow();
  });

  it('B6: path-normalisation bypass attempts never succeed for an employee', async () => {
    const employee = await createEmployee(creds);
    const { accessToken } = await loginOk(t.app, employee);
    const BS = String.fromCodePoint(0x5c); // a literal backslash
    const attempts = [
      '/api/v1/ADMIN/users',
      '/api/v1/admin/users/',
      '/api/v1/admin//users',
      '/api/v1/admin/%75sers',
      '/api/v1/auth/../admin/users',
      '/api/v1/auth/%2e%2e/admin/users',
      '/api/v1/admin/users%2f',
      '/api/v1/admin/users;x',
      '/api/v1/admin/./users',
      '/api/v1/admin/x/../users',
      `/api/v1/admin${BS}users`,
      `/api/v1${BS}admin${BS}users`,
    ];
    // Sent byte-for-byte over node:http: supertest would rewrite `./`, `../` and `\` client-side,
    // so the variants would never reach the server.
    const server = await listen(t.app);
    try {
      for (const path of attempts) {
        for (const method of ['GET', 'POST']) {
          const res = await rawRequest(server, {
            method,
            path,
            ...(method === 'POST' ? { body: '{}' } : {}),
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          expect(res.status, `${method} ${path}`).toBeGreaterThanOrEqual(400);
        }
      }
    } finally {
      await close(server);
    }
  });

  it('only registered methods match: GET on a POST-only route is 404', async () => {
    expect((await request(t.app).get('/api/v1/auth/login')).status).toBe(404);
    expect((await request(t.app).put('/api/v1/health')).status).toBe(404);
    expect((await request(t.app).options('/api/v1/auth/login')).status).toBe(404);
  });

  it('public routes stay public (sanity: PUBLIC constant is not authenticated)', () => {
    expect(PUBLIC.kind).toBe('public');
  });
});
