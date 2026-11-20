import { beforeAll, describe, expect, it } from 'vitest';
import { onboardingStateSchema } from '@csense/shared';
import request from 'supertest';
import { AuditLog, Employee, RiskProfile } from '../src/models/index.js';
import { bearer, makeCredentials } from './helpers/fixtures.js';
import {
  buildGateApp,
  createGateQuestions,
  failGate,
  gateAdmin,
  gateEmployee,
} from './helpers/gateFixtures.js';
import { clientFor, syncLearningIndexes } from './helpers/learningFixtures.js';

let creds: Awaited<ReturnType<typeof makeCredentials>>;

beforeAll(async () => {
  creds = await makeCredentials();
  await syncLearningIndexes();
});

const NOW = '2026-03-10T08:00:00.000Z';

async function setup() {
  const t = await buildGateApp();
  const e = await gateEmployee(t.app, creds);
  return { t, e, c: clientFor(t.app, e, e.token) };
}

describe('PATCH /me/onboarding', () => {
  it('ON1: completes onboarding with the server clock and /auth/me shows it', async () => {
    const { c } = await setup();
    const before = await c.get('/auth/me');
    expect(before.body.onboarding).toBeNull();

    const res = await c.patch('/me/onboarding', { outcome: 'completed' });
    expect(res.status).toBe(200);
    expect(onboardingStateSchema.parse(res.body)).toEqual({ outcome: 'completed', at: NOW });

    const me = await c.get('/auth/me');
    expect(me.body.onboarding).toEqual({ outcome: 'completed', at: NOW });
  });

  it('ON2: first write wins; a second PATCH returns the first state', async () => {
    const { t, c } = await setup();
    await c.patch('/me/onboarding', { outcome: 'completed' });
    t.advance(60_000);
    const second = await c.patch('/me/onboarding', { outcome: 'skipped' });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ outcome: 'completed', at: NOW });
  });

  it('ON3: ten concurrent PATCHes store exactly one state and all return it', async () => {
    const { e, c } = await setup();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        c.patch('/me/onboarding', { outcome: i % 2 === 0 ? 'completed' : 'skipped' }),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    const bodies = new Set(results.map((r) => JSON.stringify(r.body)));
    expect(bodies.size).toBe(1);
    const stored = await Employee.findById(e.id).lean();
    expect(stored?.onboarding?.outcome).toBe((results[0]?.body as { outcome: string }).outcome);
  });

  it('ON4: extra fields, unknown outcomes and wrong shapes are 400 and store nothing', async () => {
    const { e, c } = await setup();
    const bad: object[] = [
      { outcome: 'completed', extra: 1 },
      { outcome: 'done' },
      { onboarding: null },
      {},
      { outcome: 'completed', at: '2020-01-01T00:00:00.000Z' },
    ];
    for (const body of bad) {
      const res = await c.patch('/me/onboarding', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const stored = await Employee.findById(e.id).lean();
    expect(stored?.onboarding ?? null).toBeNull();
  });

  it('ON5: no token 401, administrator 403, restricted employee 403 ACCESS_RESTRICTED', async () => {
    const t = await buildGateApp();
    await createGateQuestions(8);

    const anon = await request(t.app).patch('/api/v1/me/onboarding').send({ outcome: 'skipped' });
    expect(anon.status).toBe(401);

    const admin = await gateAdmin(t.app, creds);
    const asAdmin = await request(t.app)
      .patch('/api/v1/me/onboarding')
      .set(...bearer(admin.token))
      .send({ outcome: 'skipped' });
    expect(asAdmin.status).toBe(403);

    const e = await gateEmployee(t.app, creds);
    await failGate(t.app, e);
    const restricted = await request(t.app)
      .patch('/api/v1/me/onboarding')
      .set(...bearer(e.token))
      .send({ outcome: 'skipped' });
    expect(restricted.status).toBe(403);
    expect(restricted.body.error.code).toBe('ACCESS_RESTRICTED');
    const stored = await Employee.findById(e.id).lean();
    expect(stored?.onboarding ?? null).toBeNull();
  });

  it('ON6: login and admin user creation carry onboarding null for a new employee', async () => {
    const { t, e } = await setup();
    const login = await request(t.app)
      .post('/api/v1/auth/login')
      .send({ email: e.email, password: e.password });
    expect(login.status).toBe(200);
    expect(login.body.user.onboarding).toBeNull();

    const admin = await gateAdmin(t.app, creds);
    const created = await request(t.app)
      .post('/api/v1/admin/users')
      .set(...bearer(admin.token))
      .send({
        name: 'New Person',
        email: 'new.person@example.com',
        password: creds.password,
        role: 'employee',
      });
    expect(created.status).toBe(201);
    expect(created.body.onboarding).toBeNull();
  });

  it('ON7: onboarding changes no XP, risk profile or audit entries', async () => {
    const { e, c } = await setup();
    const auditBefore = await AuditLog.countDocuments({});
    const riskBefore = await RiskProfile.countDocuments({});
    const xpBefore = (await c.get('/me/xp')).body;

    await c.patch('/me/onboarding', { outcome: 'completed' });
    await c.patch('/me/onboarding', { outcome: 'skipped' });

    expect((await c.get('/me/xp')).body).toEqual(xpBefore);
    expect(await AuditLog.countDocuments({})).toBe(auditBefore);
    expect(await RiskProfile.countDocuments({})).toBe(riskBefore);
    expect((await Employee.findById(e.id).lean())?.totalXP).toBe(0);
  });
});
