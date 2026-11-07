import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { silentLogger, testConfig } from './helpers/testConfig.js';

const logger = silentLogger;
let app: Express;

beforeAll(async () => {
  app = await createApp({ logger, config: testConfig({ jsonBodyLimit: '1kb' }) });
});

describe('health endpoints', () => {
  it('GET /api/v1/health returns 200 ok', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /api/v1/health/ready returns 200 when MongoDB is connected', async () => {
    const res = await request(app).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('GET /api/v1/health/ready returns 503 without internal detail when MongoDB is down', async () => {
    const downApp = await createApp({
      logger,
      config: testConfig({ jsonBodyLimit: '1kb' }),
      isReady: () => false,
    });
    const res = await request(downApp).get('/api/v1/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable' });
  });
});

describe('security baseline', () => {
  it('returns the 404 envelope for unknown routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
  });

  it('has no self-registration route', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ email: 'a@b.c' });
    expect(res.status).toBe(404);
  });

  it('sets helmet headers and hides x-powered-by', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('sets Cache-Control: no-store and a server-generated request id on API responses', async () => {
    const res = await request(app).get('/api/v1/health').set('X-Request-Id', 'attacker-chosen');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-request-id']).not.toBe('attacker-chosen');
  });

  it('enforces the JSON body limit', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(4096) }));
    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' },
    });
  });

  it('rejects malformed JSON without leaking parser details', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('content-type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'INVALID_JSON', message: 'Malformed JSON body' } });
  });
});
