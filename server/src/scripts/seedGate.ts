import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  checkExplanationEchoes,
  checkLengthRanks,
  checkNearDuplicates,
  gateQuestionAuthoringSchema,
  GATE_ATTEMPTS_DEFAULT,
  type AuthoringFinding,
  type AuthoringItem,
  type GateQuestionAuthoring,
} from '@csense/shared';
import { loadDotEnvFile } from '../config/env.js';
import { connectDb, disconnectDb } from '../db/connect.js';
import { createLogger } from '../lib/logger.js';
import { GateQuestion } from '../models/index.js';
import { SEED_GATE_QUESTIONS } from './seed/gateContent.js';
import { assertLocalMongo, assertSeedEnvironment } from './seedLearning.js';

export interface GateSeedResult {
  created: number;
  kept: number;
}

/** Parse every item with the shared authoring schema. Throws, naming the item, before any write. */
export function validateGateContent(): GateQuestionAuthoring[] {
  return SEED_GATE_QUESTIONS.map((raw, i) => {
    const parsed = gateQuestionAuthoringSchema.safeParse(raw);
    if (!parsed.success) {
      const where = parsed.error.issues.map((x) => x.path.join('.') || 'item').join(', ');
      throw new Error(`Gate seed is invalid (question ${String(i)}): ${where}`);
    }
    return parsed.data;
  });
}

/** The pool as flat items for the shared authoring checks (same rules as the Phase 3 content). */
export function gateAuthoringItems(
  questions: readonly GateQuestionAuthoring[] = validateGateContent(),
): AuthoringItem[] {
  return questions.map((q, i) => ({
    where: `gate.${String(i)}`,
    group: 'gate',
    text: q.prompt,
    options: q.options,
    correctAnswer: q.correctAnswer,
    explanation: q.explanation,
  }));
}

/** Explanation echoes, correct-option length rank and near duplicates over the whole pool. */
export function gateAuthoringFindings(
  questions: readonly GateQuestionAuthoring[] = validateGateContent(),
): AuthoringFinding[] {
  const items = gateAuthoringItems(questions);
  return [
    ...checkExplanationEchoes(items),
    ...checkLengthRanks(items),
    ...checkNearDuplicates(items),
    ...(questions.length < GATE_ATTEMPTS_DEFAULT * 4
      ? [
          {
            rule: 'pool_too_small' as const,
            where: 'gate',
            detail: `pool of ${String(questions.length)} is smaller than ${String(GATE_ATTEMPTS_DEFAULT * 4)}`,
          },
        ]
      : []),
  ];
}

const isDuplicateKey = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;

/**
 * Development and test seed for the security-gate question pool (Phase 5, 30 items). Same rules as
 * the learning seed (D3-22): it refuses to run unless NODE_ENV is development or test, validates
 * every item with the shared authoring schema and runs the authoring checks before any write, and
 * creates only questions whose prompt does not exist yet. Safe to run repeatedly.
 */
export async function seedGateContent(opts: {
  nodeEnv: string | undefined;
}): Promise<GateSeedResult> {
  assertSeedEnvironment(opts.nodeEnv);
  const questions = validateGateContent();
  const findings = gateAuthoringFindings(questions);
  if (findings.length > 0) {
    throw new Error(
      `Gate seed fails the authoring checks: ${findings.map((f) => `${f.where} (${f.rule})`).join(', ')}`,
    );
  }
  await GateQuestion.createIndexes();
  const result: GateSeedResult = { created: 0, kept: 0 };
  for (const q of questions) {
    if (await GateQuestion.exists({ prompt: q.prompt })) {
      result.kept += 1;
      continue;
    }
    try {
      const { topic, ...rest } = q;
      await GateQuestion.create({ ...rest, ...(topic ? { topic } : {}), isActive: true });
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
  const logger = createLogger('info');
  await connectDb(MONGODB_URI);
  try {
    logger.info(await seedGateContent({ nodeEnv: NODE_ENV }), 'Gate questions seeded');
  } finally {
    await disconnectDb();
  }
}

// Run only when executed directly, not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    process.stderr.write(`Seed failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
