import { afterEach, describe, expect, it } from 'vitest';
import {
  gateAttemptResultSchema,
  gateStatusSchema,
  type GateStatusDTO,
  type LoginResponse,
} from '@csense/shared';
import {
  HarnessRefusedError,
  assertHarnessEnabled,
  provisionHarness,
  type RunningHarness,
} from '../src/testing/e2eServer.js';
import { Administrator, Employee, UserProgress } from '../src/models/index.js';

describe('e2e harness guard (ADR 0018)', () => {
  it('EH1: refuses unless NODE_ENV=test AND CSENSE_E2E_HARNESS=1', () => {
    expect(() => {
      assertHarnessEnabled({ NODE_ENV: 'test', CSENSE_E2E_HARNESS: '1' });
    }).not.toThrow();
    const refused: NodeJS.ProcessEnv[] = [
      {},
      { NODE_ENV: 'test' },
      { CSENSE_E2E_HARNESS: '1' },
      { NODE_ENV: 'production', CSENSE_E2E_HARNESS: '1' },
      { NODE_ENV: 'development', CSENSE_E2E_HARNESS: '1' },
      { NODE_ENV: 'test', CSENSE_E2E_HARNESS: 'true' },
      { NODE_ENV: 'test', CSENSE_E2E_HARNESS: '0' },
      { NODE_ENV: 'test', CSENSE_E2E_HARNESS: '' },
    ];
    for (const env of refused) {
      expect(() => {
        assertHarnessEnabled(env);
      }, JSON.stringify(env)).toThrow(HarnessRefusedError);
    }
  });
});

describe('e2e harness', () => {
  // The suite wipes every collection after each test, so each test provisions its own backend.
  let harness: RunningHarness | undefined;
  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
  });

  const call = async (
    path: string,
    init: { token?: string; body?: unknown; method?: string } = {},
  ) => {
    if (!harness) throw new Error('harness not started');
    const res = await fetch(`${harness.baseUrl}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: {
        'Content-Type': 'application/json',
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const body: unknown = await res.json().catch(() => null);
    return { status: res.status, body };
  };

  it('EH2: boots, seeds the accounts and content, and serves the gate over HTTP', async () => {
    harness = await provisionHarness();
    expect(harness.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/v1$/);
    expect(Object.keys(harness.accounts).sort()).toEqual(
      ['admin', 'admin2', 'gate-fail', 'gate-pass', 'quiz'].sort(),
    );
    expect(Object.keys(harness.gateKey)).toHaveLength(30);
    expect(await Administrator.countDocuments({})).toBe(2);
    expect(await Employee.countDocuments({})).toBe(3);

    // The quiz employee has module 1's content completed.
    const quiz = await Employee.findOne({ email: harness.accounts.quiz.email }).lean();
    if (!quiz) throw new Error('quiz employee missing');
    const progress = await UserProgress.findOne({ userId: quiz._id }).lean();
    expect(progress?.contentCompletedAt).toBeTruthy();

    const login = await call('/auth/login', {
      body: harness.accounts['gate-pass'],
    });
    expect(login.status).toBe(200);
    const token = (login.body as LoginResponse).accessToken;

    const status = gateStatusSchema.parse((await call('/gate/status', { token })).body);
    expect(status.state).toBe('required');
    const opened: GateStatusDTO = gateStatusSchema.parse(
      (await call('/gate/challenge', { token, body: {} })).body,
    );
    expect(opened.state).toBe('challenge');
    expect(opened.attemptsRemaining).toBe(3);
    const challenge = opened.challenge;
    if (!challenge) throw new Error('no challenge');

    // The key by prompt is valid for the served order (identity shuffle).
    const key = harness.gateKey[challenge.prompt];
    expect(key).toBeTypeOf('number');
    expect(challenge.options[key ?? -1]).toBe(harness.gateKeyText[challenge.prompt]);
    const attempt = await call('/gate/attempts', {
      token,
      body: { challengeId: challenge.challengeId, selectedIndex: key },
    });
    expect(attempt.status).toBe(201);
    const result = gateAttemptResultSchema.parse(attempt.body);
    expect(result.correct).toBe(true);
    expect(result.status.state).toBe('granted');

    // The wrapper counts API requests and answers its own endpoint.
    const count = (await (await fetch(`${harness.origin}/__harness/requests`)).json()) as {
      count: number;
    };
    expect(count.count).toBeGreaterThanOrEqual(4);
    expect(harness.requestCount()).toBe(count.count);
    // Anything outside the registry is still a 404 (the harness adds no API route).
    expect((await call('/__harness/requests', { token })).status).toBe(404);
  });

  it('EH3: gate-fail restricts after three wrong answers and the escalation is visible to administrators', async () => {
    harness = await provisionHarness();
    const login = await call('/auth/login', { body: harness.accounts['gate-fail'] });
    const token = (login.body as LoginResponse).accessToken;
    let status = gateStatusSchema.parse((await call('/gate/challenge', { token, body: {} })).body);
    for (let i = 0; i < 3; i += 1) {
      const challenge = status.challenge;
      if (!challenge) throw new Error('no challenge');
      const key = harness.gateKey[challenge.prompt] ?? 0;
      const res = await call('/gate/attempts', {
        token,
        body: {
          challengeId: challenge.challengeId,
          selectedIndex: (key + 1) % challenge.options.length,
        },
      });
      status = gateAttemptResultSchema.parse(res.body).status;
    }
    expect(status.state).toBe('restricted');
    expect(status.restricted?.referenceId).toMatch(/^GATE-\d{8}-[0-9A-F]{6}$/);

    const admin = (await call('/auth/login', { body: harness.accounts.admin }))
      .body as LoginResponse;
    const list = (await call(`/admin/escalations?reason=gate_access_restricted`, {
      token: admin.accessToken,
    })) as { status: number; body: { items?: { id: string }[] } };
    expect(list.status).toBe(200);
    expect(list.body.items?.length ?? 0).toBeGreaterThanOrEqual(1);
  });
});
