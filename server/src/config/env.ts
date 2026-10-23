import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Environment schema. Keep in sync with the root `.env.example`.
 * The server refuses to start if any value is missing or malformed.
 */
const booleanFlag = z.enum(['true', 'false']).transform((v) => v === 'true');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z
    .string()
    .min(1)
    .refine((v) => v.startsWith('mongodb://') || v.startsWith('mongodb+srv://'), {
      message: 'must be a mongodb:// or mongodb+srv:// connection string',
    }),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  JSON_BODY_LIMIT: z
    .string()
    .regex(/^\d+(b|kb|mb)$/i, 'must look like 100kb')
    .default('100kb'),
  FEATURE_PHISHING: booleanFlag.default(false),
  FEATURE_CONTINUOUS_REVIEW: booleanFlag.default(false),
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
