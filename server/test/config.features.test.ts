import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  buildTestApp,
  createEmployee,
  loginOk,
  makeCredentials,
  type TestApp,
} from './helpers/fixtures.js';

let t: TestApp;
let creds: { password: string; hash: string };

beforeAll(async () => {
  t = await buildTestApp({ features: { phishing: true, continuousReview: false } });
  creds = await makeCredentials();
});

describe('GET /config/features', () => {
  it('CF1: an authenticated request returns the flags', async () => {
    const emp = await createEmployee(creds);
    const { accessToken } = await loginOk(t.app, emp);
    const res = await request(t.app)
      .get('/api/v1/config/features')
      .set(...bearer(accessToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ phishing: true, continuousReview: false });
  });

  it('CF2: no token returns 401', async () => {
    const res = await request(t.app).get('/api/v1/config/features');
    expect(res.status).toBe(401);
  });
});
