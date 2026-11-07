import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { toAppConfig } from '../src/config/appConfig.js';
import { loadEnv } from '../src/config/env.js';
import { randomSecret } from './helpers/testConfig.js';

const base = (): Record<string, string> => ({
  MONGODB_URI: 'mongodb://127.0.0.1:27017/csense',
  JWT_ACCESS_SECRET: randomSecret(),
  REFRESH_TOKEN_SECRET: randomSecret(),
  AUDIT_CHAIN_SECRET: randomSecret(),
});

const messageOf = (source: Record<string, string>): string => {
  try {
    loadEnv(source);
  } catch (err) {
    return (err as Error).message;
  }
  return '';
};

describe('loadEnv', () => {
  it('E1: parses a valid environment and applies defaults', () => {
    const env = loadEnv(base());
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      LOG_LEVEL: 'info',
      JSON_BODY_LIMIT: '100kb',
      FEATURE_PHISHING: false,
      FEATURE_CONTINUOUS_REVIEW: false,
      JWT_ACCESS_TTL: '15m',
      ASSESSMENT_SESSION_TTL: '60m',
      JWT_REFRESH_TTL: '7d',
      BCRYPT_COST: 12,
      RATE_LIMIT_WINDOW_MS: 900_000,
      RATE_LIMIT_MAX: 1000,
      AUTH_RATE_LIMIT_WINDOW_MS: 900_000,
      AUTH_LOGIN_MAX_PER_ACCOUNT_IP: 10,
      AUTH_LOGIN_MAX_PER_IP: 50,
      AUTH_LOGIN_TARGETED_THRESHOLD: 30,
      AUTH_FAILED_LOGIN_MIN_MS: 1000,
      AUTH_REFRESH_MAX_PER_IP: 30,
      TRUST_PROXY_HOPS: 0,
      RECONCILE_SWEEP_INTERVAL: '5m',
      ESCALATE_AFTER_COOLDOWNS: 2,
      ESCALATE_COOLDOWN_WINDOW: '7d',
    });
  });

  it('parses feature flags strictly', () => {
    const env = loadEnv({ ...base(), FEATURE_PHISHING: 'true' });
    expect(env.FEATURE_PHISHING).toBe(true);
    expect(() => loadEnv({ ...base(), FEATURE_PHISHING: 'yes' })).toThrow(/FEATURE_PHISHING/);
  });

  it('fails fast when MONGODB_URI is missing or malformed, without echoing values', () => {
    expect(() => loadEnv({})).toThrow(/MONGODB_URI/);
    const secretish = 'postgres://user:hunter2@host/db';
    const message = messageOf({ ...base(), MONGODB_URI: secretish });
    expect(message).toMatch(/MONGODB_URI/);
    expect(message).not.toContain('hunter2');
  });

  it('rejects an invalid port', () => {
    expect(() => loadEnv({ ...base(), PORT: '70000' })).toThrow(/PORT/);
  });

  it('E2: a missing secret throws, naming the key without echoing the other secret', () => {
    const { JWT_ACCESS_SECRET: _a, ...noAccess } = base();
    expect(() => loadEnv(noAccess)).toThrow(/JWT_ACCESS_SECRET/);
    const { REFRESH_TOKEN_SECRET: _r, ...noRefresh } = base();
    const env = { ...noRefresh };
    const message = messageOf(env);
    expect(message).toMatch(/REFRESH_TOKEN_SECRET/);
    expect(message).not.toContain(env.JWT_ACCESS_SECRET);
  });

  it('E3: a secret shorter than 43 characters throws without echoing it', () => {
    const short = 'short-secret-value';
    const message = messageOf({ ...base(), JWT_ACCESS_SECRET: short });
    expect(message).toMatch(/JWT_ACCESS_SECRET/);
    expect(message).not.toContain(short);
    // 42 base64url characters with plenty of variety is still one character short.
    const almost = randomBytes(32).toString('base64url').slice(0, 42);
    expect(() => loadEnv({ ...base(), REFRESH_TOKEN_SECRET: almost })).toThrow(
      /REFRESH_TOKEN_SECRET/,
    );
  });

  it('E3b [P2-L4]: secrets must look generated: charset, length and distinct characters', () => {
    const keys = ['JWT_ACCESS_SECRET', 'REFRESH_TOKEN_SECRET', 'AUDIT_CHAIN_SECRET'] as const;
    const weak: [string, string][] = [
      ['repeated single character', 'a'.repeat(64)],
      ['repeated short phrase', 'abcdefgh'.repeat(8)],
      ['too few distinct characters', 'abcdefghijklmno'.repeat(4)], // 15 distinct
      ['non-base64url characters', `${randomBytes(48).toString('base64url')}+/=`],
      [
        'whitespace',
        `${randomBytes(30).toString('base64url')} ${randomBytes(30).toString('base64url')}`,
      ],
      ['too short', randomBytes(31).toString('base64url')], // 42 characters
    ];
    for (const key of keys) {
      for (const [name, value] of weak) {
        const message = messageOf({ ...base(), [key]: value });
        expect(message, `${key} ${name}`).toMatch(new RegExp(key));
        expect(message, `${key} ${name}`).not.toContain(value);
      }
    }
  });

  it('E3c [P2-L4]: 32 random bytes, 48 random bytes and the .env.example command all pass', () => {
    for (const bytes of [32, 48, 64]) {
      const env = loadEnv({
        ...base(),
        JWT_ACCESS_SECRET: randomBytes(bytes).toString('base64url'),
        REFRESH_TOKEN_SECRET: randomBytes(bytes).toString('base64url'),
      });
      expect(env.JWT_ACCESS_SECRET.length).toBeGreaterThanOrEqual(43);
    }
    // The test helper's secrets must satisfy the same rule.
    expect(() => loadEnv(base())).not.toThrow();
    // Exactly the lower bound: 16 distinct characters, 43 long.
    const bound = 'ABCDEFGHIJKLMNOP'.repeat(3).slice(0, 43);
    expect(new Set(bound).size).toBe(16);
    expect(() => loadEnv({ ...base(), JWT_ACCESS_SECRET: bound })).not.toThrow();
  });

  it('E8: AUTH_FAILED_LOGIN_MIN_MS accepts 0, rejects negatives and absurd values', () => {
    expect(loadEnv({ ...base(), AUTH_FAILED_LOGIN_MIN_MS: '0' }).AUTH_FAILED_LOGIN_MIN_MS).toBe(0);
    expect(loadEnv({ ...base(), AUTH_FAILED_LOGIN_MIN_MS: '250' }).AUTH_FAILED_LOGIN_MIN_MS).toBe(
      250,
    );
    for (const bad of ['-1', '10001', 'abc', '1.5']) {
      expect(() => loadEnv({ ...base(), AUTH_FAILED_LOGIN_MIN_MS: bad })).toThrow(
        /AUTH_FAILED_LOGIN_MIN_MS/,
      );
    }
  });

  it('E4: identical secrets throw', () => {
    const same = randomSecret();
    const message = messageOf({ ...base(), JWT_ACCESS_SECRET: same, REFRESH_TOKEN_SECRET: same });
    expect(message).toMatch(/must differ/);
    expect(message).not.toContain(same);
  });

  it('E4b: AUDIT_CHAIN_SECRET is required, generated-looking and distinct from the other secrets', () => {
    const { AUDIT_CHAIN_SECRET: _a, ...without } = base();
    expect(() => loadEnv(without)).toThrow(/AUDIT_CHAIN_SECRET/);
    for (const other of ['JWT_ACCESS_SECRET', 'REFRESH_TOKEN_SECRET'] as const) {
      const b = base();
      const shared = b[other] ?? '';
      const message = messageOf({ ...b, AUDIT_CHAIN_SECRET: shared });
      expect(message).toMatch(/AUDIT_CHAIN_SECRET: must differ from/);
      expect(message).not.toContain(shared);
    }
    expect(toAppConfig(loadEnv(base())).audit.chainSecret.length).toBeGreaterThanOrEqual(43);
  });

  it('E4c: RECONCILE_SWEEP_INTERVAL accepts 0 and 1m..1h; ESCALATE_* have bounds', () => {
    for (const ok of ['0', '1m', '5m', '1h', '90s', '3600s']) {
      expect(loadEnv({ ...base(), RECONCILE_SWEEP_INTERVAL: ok }).RECONCILE_SWEEP_INTERVAL).toBe(
        ok,
      );
    }
    for (const bad of ['30s', '2h', '1d', '5', '-1m', 'abc', '']) {
      expect(() => loadEnv({ ...base(), RECONCILE_SWEEP_INTERVAL: bad }), bad).toThrow(
        /RECONCILE_SWEEP_INTERVAL/,
      );
    }
    expect(toAppConfig(loadEnv({ ...base(), RECONCILE_SWEEP_INTERVAL: '0' })).maintenance).toEqual({
      sweepIntervalSeconds: 0,
    });
    expect(toAppConfig(loadEnv(base())).maintenance.sweepIntervalSeconds).toBe(300);
    expect(toAppConfig(loadEnv(base())).governance).toEqual({
      escalateAfterCooldowns: 2,
      cooldownWindowSeconds: 604_800,
    });
    for (const bad of ['0', '21', '1.5', 'x']) {
      expect(() => loadEnv({ ...base(), ESCALATE_AFTER_COOLDOWNS: bad }), bad).toThrow(
        /ESCALATE_AFTER_COOLDOWNS/,
      );
    }
    for (const bad of ['59m', '91d', '7', 'x']) {
      expect(() => loadEnv({ ...base(), ESCALATE_COOLDOWN_WINDOW: bad }), bad).toThrow(
        /ESCALATE_COOLDOWN_WINDOW/,
      );
    }
  });

  it('E5: BCRYPT_COST below 12 or above 15 throws; 12 and 13 are accepted', () => {
    for (const bad of ['10', '11', '16']) {
      expect(() => loadEnv({ ...base(), BCRYPT_COST: bad })).toThrow(/BCRYPT_COST/);
    }
    expect(loadEnv({ ...base(), BCRYPT_COST: '12' }).BCRYPT_COST).toBe(12);
    expect(loadEnv({ ...base(), BCRYPT_COST: '13' }).BCRYPT_COST).toBe(13);
  });

  it('E6: malformed and out-of-bounds TTLs throw', () => {
    for (const bad of ['15', '15x', '-1m', '2h', '0m', '30s']) {
      expect(() => loadEnv({ ...base(), JWT_ACCESS_TTL: bad })).toThrow(/JWT_ACCESS_TTL/);
    }
    for (const bad of ['60d', '7', '1m', '15x']) {
      expect(() => loadEnv({ ...base(), JWT_REFRESH_TTL: bad })).toThrow(/JWT_REFRESH_TTL/);
    }
    expect(loadEnv({ ...base(), JWT_ACCESS_TTL: '30m', JWT_REFRESH_TTL: '14d' })).toBeDefined();
  });

  it('E9: ASSESSMENT_SESSION_TTL accepts 5m..4h and rejects anything else', () => {
    for (const ok of ['5m', '60m', '90m', '4h', '240m', '14400s']) {
      expect(loadEnv({ ...base(), ASSESSMENT_SESSION_TTL: ok }).ASSESSMENT_SESSION_TTL).toBe(ok);
    }
    for (const bad of ['4m', '299s', '5h', '1d', '0m', '60', '60x', '-5m', '', 'abc']) {
      expect(() => loadEnv({ ...base(), ASSESSMENT_SESSION_TTL: bad }), bad).toThrow(
        /ASSESSMENT_SESSION_TTL/,
      );
    }
  });

  it('E9b: toAppConfig turns the session TTL into seconds', () => {
    expect(
      toAppConfig(loadEnv({ ...base(), ASSESSMENT_SESSION_TTL: '90m' })).learning.sessionTtlSeconds,
    ).toBe(5400);
    expect(toAppConfig(loadEnv(base())).learning.sessionTtlSeconds).toBe(3600);
  });

  it('E7: non-positive limits and TRUST_PROXY_HOPS above 5 throw', () => {
    for (const key of [
      'RATE_LIMIT_WINDOW_MS',
      'RATE_LIMIT_MAX',
      'AUTH_RATE_LIMIT_WINDOW_MS',
      'AUTH_LOGIN_MAX_PER_ACCOUNT_IP',
      'AUTH_LOGIN_MAX_PER_IP',
      'AUTH_LOGIN_TARGETED_THRESHOLD',
      'AUTH_REFRESH_MAX_PER_IP',
    ]) {
      expect(() => loadEnv({ ...base(), [key]: '0' })).toThrow(new RegExp(key));
      expect(() => loadEnv({ ...base(), [key]: '-5' })).toThrow(new RegExp(key));
    }
    expect(() => loadEnv({ ...base(), TRUST_PROXY_HOPS: '9' })).toThrow(/TRUST_PROXY_HOPS/);
  });
});
