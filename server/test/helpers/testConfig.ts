import { randomBytes } from 'node:crypto';
import { pino } from 'pino';
import type { AppConfig } from '../../src/config/appConfig.js';

/** Fresh random secret per call: no secret is ever hard-coded in tests, and CI needs no env vars. */
export const randomSecret = (): string => randomBytes(48).toString('base64url');

export const silentLogger = pino({ level: 'silent' });

type ConfigOverrides = Partial<Omit<AppConfig, 'rateLimit' | 'learning'>> & {
  rateLimit?: Partial<AppConfig['rateLimit']>;
  learning?: Partial<AppConfig['learning']>;
};

/** AppConfig with random secrets and limits high enough not to interfere, unless overridden. */
export function testConfig(overrides: ConfigOverrides = {}): AppConfig {
  const { rateLimit, learning, ...rest } = overrides;
  return {
    jsonBodyLimit: '100kb',
    jwtAccessSecret: randomSecret(),
    refreshTokenSecret: randomSecret(),
    accessTtlSeconds: 900,
    refreshTtlSeconds: 7 * 86_400,
    bcryptCost: 12,
    trustProxyHops: 0,
    failedLoginMinMs: 0, // only the timing tests enable a real floor
    features: { phishing: false, continuousReview: false },
    learning: {
      sessionTtlSeconds: 3600,
      hookTimeoutMs: 2000,
      startReuseSeconds: 0,
      // High so unrelated tests never hit it; the cooldown tests lower it explicitly.
      cooldownAfterFails: 1000,
      cooldownMinutes: 15,
      ...learning,
    },
    ...rest,
    rateLimit: {
      windowMs: 900_000,
      max: 100_000,
      authWindowMs: 900_000,
      loginMaxPerAccountIp: 100_000,
      loginMaxPerIp: 100_000,
      loginTargetedThreshold: 100_000,
      refreshMaxPerIp: 100_000,
      sessionStartMax: 20,
      sessionStartWindowMs: 600_000,
      ...rateLimit,
    },
  };
}

/** A clock tests can move forward without fake timers. */
export function controllableClock(start = new Date()): {
  clock: () => Date;
  advance: (ms: number) => void;
} {
  let current = start.getTime();
  return {
    clock: () => new Date(current),
    advance: (ms) => {
      current += ms;
    },
  };
}
