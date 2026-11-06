import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { createLimiters } from '../src/middleware/rateLimit.js';
import { AuditLog } from '../src/models/index.js';
import {
  buildTestApp,
  createEmployee,
  makeCredentials,
  type SeedUser,
  type TestApp,
} from './helpers/fixtures.js';
import { silentLogger, testConfig } from './helpers/testConfig.js';

let creds: { password: string; hash: string };
let emp: SeedUser;

beforeAll(async () => {
  creds = await makeCredentials();
});

beforeEach(async () => {
  emp = await createEmployee(creds);
});

const login = (app: TestApp['app'], email: string, password: string) =>
  request(app).post('/api/v1/auth/login').send({ email, password });

describe('rate limiting', () => {
  it('RL1: repeated failures for one email lead to 429, even with the right password, and are audited', async () => {
    const t = await buildTestApp({ rateLimit: { loginMaxPerAccountIp: 3 } });
    for (let i = 0; i < 3; i += 1) {
      expect((await login(t.app, emp.email, 'wrong-password-1')).status).toBe(401);
    }
    const limited = await login(t.app, emp.email, 'wrong-password-1');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['ratelimit']).toBeDefined();

    const correct = await login(t.app, emp.email, emp.password);
    expect(correct.status).toBe(429);

    const entries = await AuditLog.find({ action: 'auth.login.rate_limited' }).lean();
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(entries)).not.toContain(emp.email);
    // A different account is unaffected by this account's limiter.
    const other = await createEmployee(creds);
    expect((await login(t.app, other.email, other.password)).status).toBe(200);
  });

  it('RL2: unknown and known emails trip at the same count (no enumeration)', async () => {
    const t = await buildTestApp({ rateLimit: { loginMaxPerAccountIp: 2 } });
    const statuses = async (email: string): Promise<number[]> => {
      const out: number[] = [];
      for (let i = 0; i < 4; i += 1) out.push((await login(t.app, email, 'nope-nope-nope')).status);
      return out;
    };
    expect(await statuses(emp.email)).toEqual([401, 401, 429, 429]);
    expect(await statuses('ghost@example.com')).toEqual([401, 401, 429, 429]);
  });

  it('RL3: successful logins are not counted', async () => {
    const t = await buildTestApp({ rateLimit: { loginMaxPerAccountIp: 2, loginMaxPerIp: 2 } });
    for (let i = 0; i < 5; i += 1) {
      expect((await login(t.app, emp.email, emp.password)).status).toBe(200);
    }
  });

  it('RL4: failures across different emails trip the per-IP limit', async () => {
    const t = await buildTestApp({ rateLimit: { loginMaxPerIp: 3 } });
    for (let i = 0; i < 3; i += 1) {
      expect((await login(t.app, `user${String(i)}@example.com`, 'nope-nope-nope')).status).toBe(
        401,
      );
    }
    const res = await login(t.app, 'user99@example.com', 'nope-nope-nope');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('RL5: refresh failures trip a 429', async () => {
    const t = await buildTestApp({ rateLimit: { refreshMaxPerIp: 3 } });
    const refresh = () =>
      request(t.app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: `${'0'.repeat(24)}.${'A'.repeat(43)}` });
    for (let i = 0; i < 3; i += 1) expect((await refresh()).status).toBe(401);
    const limited = await refresh();
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('RL6: the global limiter returns 429, while health stays exempt', async () => {
    const t = await buildTestApp({ rateLimit: { max: 3 } });
    for (let i = 0; i < 3; i += 1) {
      expect((await request(t.app).get('/api/v1/auth/me')).status).toBe(401);
    }
    const limited = await request(t.app).get('/api/v1/auth/me');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    for (let i = 0; i < 6; i += 1) {
      expect((await request(t.app).get('/api/v1/health')).status).toBe(200);
      expect((await request(t.app).get('/api/v1/health/ready')).status).toBe(200);
    }
  });

  it('RL7: with TRUST_PROXY_HOPS=0 a spoofed X-Forwarded-For does not reset the counter', async () => {
    const t = await buildTestApp({ trustProxyHops: 0, rateLimit: { loginMaxPerIp: 3 } });
    for (let i = 0; i < 3; i += 1) {
      const res = await login(t.app, `spoof${String(i)}@example.com`, 'nope-nope-nope').set(
        'X-Forwarded-For',
        `10.0.0.${String(i + 1)}`,
      );
      expect(res.status).toBe(401);
    }
    const res = await login(t.app, 'spoof9@example.com', 'nope-nope-nope').set(
      'X-Forwarded-For',
      '203.0.113.77',
    );
    expect(res.status).toBe(429);
  });

  it('RL8: a parallel burst of wrong guesses cannot exceed the (email, IP) hard limit', async () => {
    const t = await buildTestApp({ rateLimit: { loginMaxPerAccountIp: 3 } });
    const results = await Promise.all(
      Array.from({ length: 12 }, () => login(t.app, emp.email, 'wrong-password-1')),
    );
    expect(results.filter((r) => r.status === 401)).toHaveLength(3);
    expect(results.filter((r) => r.status === 429)).toHaveLength(9);
  });

  it('RL9: the per-IP limiter runs first; its rejections never touch any account counter', async () => {
    // Threshold 1 makes the account-wide counter observable: one counted failure = one audit entry.
    const t = await buildTestApp({
      rateLimit: { loginMaxPerIp: 2, loginMaxPerAccountIp: 2, loginTargetedThreshold: 1 },
    });
    const other = await createEmployee(creds);
    for (let i = 0; i < 2; i += 1) {
      expect((await login(t.app, other.email, 'wrong-password-1')).status).toBe(401);
    }
    // The IP is now blocked. Were these counted, emp would be flagged as targeted.
    for (let i = 0; i < 6; i += 1) {
      expect((await login(t.app, emp.email, 'wrong-password-1')).status).toBe(429);
    }
    await vi.waitFor(async () => {
      expect(await AuditLog.countDocuments({ action: 'auth.login.account_targeted' })).toBe(1);
    });
    const flagged = await AuditLog.find({ action: 'auth.login.account_targeted' }).lean();
    expect(String(flagged[0]?.targetId)).toBe(other.id);
    expect(await AuditLog.countDocuments({ targetId: emp.id })).toBe(0);
  });

  it('RL10: the hard-limit window expires (injected clock)', async () => {
    let now = 1_000_000;
    const cfg = testConfig({ rateLimit: { loginMaxPerAccountIp: 2, authWindowMs: 60_000 } });
    const limiters = createLimiters(cfg.rateLimit, { now: () => now });
    const app = express();
    app.use(express.json());
    app.post('/login', limiters.login[1] as express.RequestHandler, (req, res) => {
      const ok = (req.body as { password?: string }).password === 'right';
      res.status(ok ? 200 : 401).json({});
    });
    app.use(errorHandler(silentLogger));
    const post = (password: string) =>
      request(app).post('/login').send({ email: 'win@example.com', password });
    expect((await post('bad')).status).toBe(401);
    expect((await post('bad')).status).toBe(401);
    const blocked = await post('right');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBe(60);
    now += 60_001;
    expect((await post('right')).status).toBe(200);
  });
});
