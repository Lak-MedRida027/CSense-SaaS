import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { badgeAuthoringSchema } from '@csense/shared';
import { loadDotEnvFile } from '../config/env.js';
import { connectDb, disconnectDb } from '../db/connect.js';
import { createLogger } from '../lib/logger.js';
import { Badge, Module } from '../models/index.js';
import { SEED_BADGES } from './seed/badgeContent.js';
import { assertLocalMongo, assertSeedEnvironment } from './seedLearning.js';

export interface BadgeSeedResult {
  created: number;
  kept: number;
  /** Seed badges whose module does not exist (seed the modules first). */
  skipped: number;
}

const isDuplicateKey = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;

/**
 * Development and test seed for badges. Same rules as the learning seed (D3-22): it refuses to run
 * unless NODE_ENV is development or test, validates every item with the shared authoring schema
 * before writing, creates only what is missing and keeps what exists. A duplicate caused by a
 * race counts as kept, so it is safe to run repeatedly and concurrently.
 */
export async function seedBadges(opts: { nodeEnv: string | undefined }): Promise<BadgeSeedResult> {
  assertSeedEnvironment(opts.nodeEnv);
  const items = Object.entries(SEED_BADGES).map(([order, raw]) => {
    const parsed = badgeAuthoringSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`Badge seed is invalid (module ${order})`);
    return { order: Number(order), badge: parsed.data };
  });

  await Badge.createIndexes();
  const result: BadgeSeedResult = { created: 0, kept: 0, skipped: 0 };
  for (const { order, badge } of items) {
    const mod = await Module.findOne({ order }).select('_id').lean();
    if (!mod) {
      result.skipped += 1;
      continue;
    }
    if (await Badge.exists({ moduleId: mod._id })) {
      result.kept += 1;
      continue;
    }
    try {
      await Badge.create({ ...badge, moduleId: mod._id });
      result.created += 1;
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      result.kept += 1;
    }
  }
  return result;
}

const envSchema = z.object({
  MONGODB_URI: z
    .string()
    .refine((v) => v.startsWith('mongodb://') || v.startsWith('mongodb+srv://'), {
      message: 'must be a mongodb:// or mongodb+srv:// connection string',
    }),
  NODE_ENV: z.string().optional(),
  SEED_ALLOW_REMOTE: z.enum(['true', 'false']).default('false'),
});

async function main(): Promise<void> {
  loadDotEnvFile();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(', ');
    throw new Error(`Invalid environment configuration: ${keys}`);
  }
  const { MONGODB_URI, NODE_ENV, SEED_ALLOW_REMOTE } = parsed.data;
  assertSeedEnvironment(NODE_ENV);
  assertLocalMongo(MONGODB_URI, SEED_ALLOW_REMOTE === 'true');
  await connectDb(MONGODB_URI);
  try {
    const result = await seedBadges({ nodeEnv: NODE_ENV });
    createLogger('info').info(result, 'Badges seeded');
  } finally {
    await disconnectDb();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `Badge seed failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
