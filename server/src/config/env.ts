import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { BCRYPT_MIN_COST } from '@csense/shared';
import { isDuration, parseDuration } from '../lib/duration.js';

/**
 * Environment schema. Keep in sync with the root `.env.example`.
 * The server refuses to start if any value is missing or malformed.
 */
const booleanFlag = z.enum(['true', 'false']).transform((v) => v === 'true');

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;

/** Duration like 15m / 7d that must fall within [minSeconds, maxSeconds]. */
const boundedDuration = (minSeconds: number, maxSeconds: number, fallback: string) =>
  z
    .string()
    .regex(/^\d+[smhd]$/, 'must look like 15m, 12h or 7d')
    .refine(
      (v) => {
        if (!isDuration(v)) return false;
        const seconds = parseDuration(v);
        return seconds >= minSeconds && seconds <= maxSeconds;
      },
      { message: 'is outside the allowed range' },
    )
    .default(fallback);

const positiveInt = (fallback: number) => z.coerce.number().int().min(1).default(fallback);

const SECRET_MIN_LENGTH = 43; // 32 random bytes in base64url
const SECRET_MIN_DISTINCT = 16;

/**
 * A signing secret must look generated: base64url charset, at least 32 bytes of entropy worth of
 * characters, and enough distinct characters to reject 'aaaa...' or repeated phrases. Messages name
 * the key (added by loadEnv) and never echo the value.
 */
const generatedSecret = z
  .string()
  .min(SECRET_MIN_LENGTH, `must be at least ${String(SECRET_MIN_LENGTH)} characters`)
  .regex(/^[A-Za-z0-9_-]+$/, 'must use only base64url characters (A-Z, a-z, 0-9, - and _)')
  .refine((v) => new Set(v).size >= SECRET_MIN_DISTINCT, {
    message: `must contain at least ${String(SECRET_MIN_DISTINCT)} distinct characters; generate it randomly`,
  });

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    MONGODB_URI: z
      .string()
      .min(1)
      .refine((v) => v.startsWith('mongodb://') || v.startsWith('mongodb+srv://'), {
        message: 'must be a mongodb:// or mongodb+srv:// connection string',
      }),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    JSON_BODY_LIMIT: z
      .string()
      .regex(/^\d+(b|kb|mb)$/i, 'must look like 100kb')
      .default('100kb'),
    FEATURE_PHISHING: booleanFlag.default(false),
    FEATURE_CONTINUOUS_REVIEW: booleanFlag.default(false),

    // --- Authentication and security (Phase 2, ADR 0004). Secrets have no defaults on purpose. ---
    JWT_ACCESS_SECRET: generatedSecret,
    REFRESH_TOKEN_SECRET: generatedSecret,
    JWT_ACCESS_TTL: boundedDuration(MINUTE, 30 * MINUTE, '15m'),
    JWT_REFRESH_TTL: boundedDuration(HOUR, 14 * DAY, '7d'),
    BCRYPT_COST: z.coerce.number().int().min(BCRYPT_MIN_COST).max(15).default(BCRYPT_MIN_COST),
    RATE_LIMIT_WINDOW_MS: positiveInt(900_000),
    RATE_LIMIT_MAX: positiveInt(1000),
    AUTH_RATE_LIMIT_WINDOW_MS: positiveInt(900_000),
    AUTH_LOGIN_MAX_PER_ACCOUNT_IP: positiveInt(10),
    AUTH_LOGIN_MAX_PER_IP: positiveInt(50),
    AUTH_LOGIN_TARGETED_THRESHOLD: positiveInt(30),
    AUTH_FAILED_LOGIN_MIN_MS: z.coerce.number().int().min(0).max(10_000).default(1000),
    AUTH_REFRESH_MAX_PER_IP: positiveInt(30),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  })
  .superRefine((env, ctx) => {
    if (env.JWT_ACCESS_SECRET === env.REFRESH_TOKEN_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['REFRESH_TOKEN_SECRET'],
        message: 'must differ from JWT_ACCESS_SECRET',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Load the repo-root `.env` (if present) without overriding variables already set,
 * then validate. Works whether started from the repo root or from `server/`.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (source === process.env) {
    for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../.env')]) {
      if (existsSync(candidate)) {
        process.loadEnvFile(candidate);
        break;
      }
    }
  }

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Report which keys are invalid, never their values (they may be secrets).
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}
