import { pathToFileURL } from 'node:url';
import mongoose, { type Types } from 'mongoose';
import { z } from 'zod';
import {
  assessmentAuthoringSchema,
  moduleAuthoringSchema,
  type AssessmentAuthoring,
  type AuthoringFinding,
  type AuthoringItem,
  checkExplanationEchoes,
  checkLengthRanks,
  checkNearDuplicates,
  checkPoolSizes,
  type ModuleAuthoring,
} from '@csense/shared';
import { loadDotEnvFile } from '../config/env.js';
import { connectDb, disconnectDb } from '../db/connect.js';
import { audit } from '../features/audit/audit.service.js';
import { createLogger } from '../lib/logger.js';
import {
  Assessment,
  AssessmentSession,
  FinalTest,
  Module,
  Quiz,
  QuizAttempt,
  UserProgress,
} from '../models/index.js';
import { SEED_FINAL_TEST, SEED_MODULES, SEED_QUIZZES } from './seed/learningContent.js';

/**
 * Development and test seed for the learning content (Phase 3, plan section 9). It fails closed:
 * NODE_ENV must be explicitly development or test, a non-local MongoDB needs SEED_ALLOW_REMOTE=true,
 * and --reset needs --confirm=<database name> and is audited. Existing items are kept untouched; only missing ones are created, so it is safe to
 * run repeatedly and to complete a partly seeded database.
 */
export interface SeedCounts {
  modules: number;
  quizzes: number;
  finalTest: number;
}

export interface SeedResult {
  created: SeedCounts;
  kept: SeedCounts;
}

export interface SeedOptions {
  /** Must be exactly development or test; anything else, including undefined, is refused. */
  nodeEnv: string | undefined;
  /** Delete all learning content and progress first (development only). */
  reset?: boolean;
  /** Required with reset: must equal the name of the database being wiped. */
  confirm?: string | undefined;
  /** Database name; defaults to the current connection's. */
  dbName?: string;
}

export class SeedRefusedError extends Error {
  constructor(reason: string) {
    super(`Refusing to seed: ${reason}`);
    this.name = 'SeedRefusedError';
  }
}

/** Fails closed: an unset or unknown NODE_ENV is refused, not treated as development. */
export function assertSeedEnvironment(nodeEnv: string | undefined): void {
  if (nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new SeedRefusedError(
      'NODE_ENV must be set to development or test. The learning seed is not for other environments.',
    );
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Hosts named by a mongodb:// URI. mongodb+srv:// is always remote. */
function hostsOf(uri: string): string[] | null {
  if (uri.startsWith('mongodb+srv://')) return null;
  const rest = uri.slice('mongodb://'.length);
  const authority = rest.split(/[/?]/)[0] ?? '';
  const hostList = authority.includes('@')
    ? authority.slice(authority.lastIndexOf('@') + 1)
    : authority;
  return hostList.split(',').map((h) => h.replace(/:\d+$/, '').toLowerCase());
}

/** Refuses a non-local MongoDB unless the operator opted in with SEED_ALLOW_REMOTE=true. */
export function assertLocalMongo(uri: string, allowRemote: boolean): void {
  if (allowRemote) return;
  const hosts = hostsOf(uri);
  if (hosts === null || hosts.some((h) => !LOCAL_HOSTS.has(h))) {
    throw new SeedRefusedError(
      'the MongoDB host is not local. Set SEED_ALLOW_REMOTE=true only if you really mean it.',
    );
  }
}

/** Database named by the URI path ("test" when absent, like the driver). */
export function databaseNameOf(uri: string): string {
  const afterScheme = uri.replace(/^mongodb(\+srv)?:\/\//, '');
  const slash = afterScheme.indexOf('/');
  if (slash === -1) return 'test';
  const name = afterScheme.slice(slash + 1).split('?')[0] ?? '';
  return name === '' ? 'test' : decodeURIComponent(name);
}

export interface ValidatedSeed {
  modules: ModuleAuthoring[];
  quizzes: Map<number, AssessmentAuthoring>;
  finalTest: AssessmentAuthoring;
}

/** Parse every item with the shared authoring schemas. Throws, naming the item, before any write. */
export function validateSeedContent(): ValidatedSeed {
  const fail = (what: string, error: z.ZodError): never => {
    const where = error.issues.map((i) => i.path.join('.') || 'item').join(', ');
    throw new Error(`Seed content is invalid (${what}): ${where}`);
  };
  const modules = SEED_MODULES.map((m) => {
    const parsed = moduleAuthoringSchema.safeParse(m);
    return parsed.success ? parsed.data : fail(`module ${String(m.order)}`, parsed.error);
  });
  const quizzes = new Map<number, AssessmentAuthoring>();
  for (const m of modules) {
    const raw = SEED_QUIZZES[m.order];
    if (!raw) throw new Error(`Seed content is invalid: module ${String(m.order)} has no quiz`);
    const parsed = assessmentAuthoringSchema.safeParse(raw);
    quizzes.set(
      m.order,
      parsed.success ? parsed.data : fail(`quiz ${String(m.order)}`, parsed.error),
    );
  }
  const finalParsed = assessmentAuthoringSchema.safeParse(SEED_FINAL_TEST);
  const finalTest = finalParsed.success ? finalParsed.data : fail('final test', finalParsed.error);
  return { modules, quizzes, finalTest };
}

const isDuplicateKey = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;

/** QuizAttempt is append-only at the model layer, so a reset goes through the driver. */
async function resetLearningData(): Promise<void> {
  await Promise.all(
    [Module, Assessment, UserProgress, QuizAttempt, AssessmentSession].map((m) =>
      m.collection.deleteMany({}),
    ),
  );
}

export async function seedLearningContent(opts: SeedOptions): Promise<SeedResult> {
  assertSeedEnvironment(opts.nodeEnv);
  const content = validateSeedContent();

  if (opts.reset) {
    const dbName = opts.dbName ?? mongoose.connection.name;
    if (opts.confirm !== dbName) {
      throw new SeedRefusedError(
        `--reset wipes learning data. Repeat the database name: --confirm=${dbName}`,
      );
    }
    // Written first, so a failed audit write stops the wipe instead of leaving no trace.
    await audit.record({
      action: 'learning.seed.reset',
      outcome: 'success',
      severity: 'critical',
      actor: null,
      metadata: { database: dbName, nodeEnv: opts.nodeEnv },
    });
    await resetLearningData();
  }
  // The unique indexes are what make a racing second run safe.
  await Promise.all([Module.createIndexes(), Assessment.createIndexes()]);

  const created: SeedCounts = { modules: 0, quizzes: 0, finalTest: 0 };
  const kept: SeedCounts = { modules: 0, quizzes: 0, finalTest: 0 };

  for (const m of content.modules) {
    const { videoUrl, captionsUrl, ...rest } = m;
    const doc = {
      ...rest,
      ...(videoUrl ? { videoUrl } : {}),
      ...(captionsUrl ? { captionsUrl } : {}),
    };
    let moduleId: Types.ObjectId | undefined = (
      await Module.findOne({ order: m.order }).select('_id')
    )?._id;
    if (moduleId) {
      kept.modules += 1;
    } else {
      try {
        moduleId = (await Module.create(doc))._id;
        created.modules += 1;
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
        moduleId = (await Module.findOne({ order: m.order }).select('_id'))?._id;
        kept.modules += 1;
      }
    }
    if (!moduleId) throw new Error(`Module ${String(m.order)} vanished during seeding`);

    const quiz = content.quizzes.get(m.order);
    if (!quiz) continue;
    if (await Quiz.exists({ moduleId })) {
      kept.quizzes += 1;
      continue;
    }
    try {
      await Quiz.create({ ...quiz, moduleId });
      created.quizzes += 1;
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      kept.quizzes += 1;
    }
  }

  if (await FinalTest.exists({})) {
    kept.finalTest += 1;
  } else {
    try {
      await FinalTest.create(content.finalTest);
      created.finalTest += 1;
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      kept.finalTest += 1;
    }
  }
  return { created, kept };
}

/** Seeding needs no auth secrets, so it validates only what it uses. */
const seedEnvSchema = z.object({
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
  const parsed = seedEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(', ');
    throw new Error(`Invalid environment configuration: ${keys}`);
  }
  const { MONGODB_URI, NODE_ENV, SEED_ALLOW_REMOTE } = parsed.data;
  // All checks run before the database is touched.
  assertSeedEnvironment(NODE_ENV);
  assertLocalMongo(MONGODB_URI, SEED_ALLOW_REMOTE === 'true');
  const reset = process.argv.includes('--reset');
  const confirm = process.argv.find((a) => a.startsWith('--confirm='))?.slice('--confirm='.length);
  const dbName = databaseNameOf(MONGODB_URI);
  if (reset && confirm !== dbName) {
    throw new SeedRefusedError(
      `--reset wipes learning data. Repeat the database name: --confirm=${dbName}`,
    );
  }
  const logger = createLogger('info');

  await connectDb(MONGODB_URI);
  try {
    const result = await seedLearningContent({ nodeEnv: NODE_ENV, reset, confirm, dbName });
    logger.info({ ...result, reset }, 'Learning content seeded');
  } finally {
    await disconnectDb();
  }
}

// Run only when executed directly, not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    process.stderr.write(`Seed failed: ${err instanceof Error ? err.message : String(err)}
`);
    process.exit(1);
  });
}

/** The seed as flat items for the shared authoring checks (explanation leaks, key length, duplicates). */
export function seedAuthoringItems(
  content: ValidatedSeed = validateSeedContent(),
): AuthoringItem[] {
  const items: AuthoringItem[] = [];
  for (const m of content.modules) {
    m.exercises.forEach((e, i) => {
      items.push({
        where: `exercise${String(m.order)}.${String(i)}`,
        group: `exercises${String(m.order)}`,
        text: e.prompt,
        options: e.options,
        correctAnswer: e.correctAnswer,
        explanation: e.explanation,
      });
    });
  }
  for (const [order, quiz] of content.quizzes) {
    quiz.questions.forEach((q, i) => {
      items.push({
        where: `quiz${String(order)}.${String(i)}`,
        group: `quiz${String(order)}`,
        text: q.text,
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
      });
    });
  }
  content.finalTest.questions.forEach((q, i) => {
    items.push({
      where: `final.${String(i)}`,
      group: 'final',
      text: q.text,
      options: q.options,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
    });
  });
  return items;
}

/**
 * Authoring check over the whole seed. Explanations and key length are judged on scored items only
 * (quizzes and the final test): an exercise reveals its key and explanation straight after the
 * answer, by design. Near-duplicates are judged over everything, so a disclosed exercise never
 * reappears as a scored question.
 */
export function seedAuthoringFindings(
  content: ValidatedSeed = validateSeedContent(),
): AuthoringFinding[] {
  const all = seedAuthoringItems(content);
  const scored = all.filter((i) => !i.group.startsWith('exercises'));
  return [
    ...checkExplanationEchoes(scored),
    ...checkLengthRanks(scored),
    ...checkNearDuplicates(all),
    ...checkPoolSizes([
      ...[...content.quizzes].map(([order, quiz]) => ({
        name: `quiz${String(order)}`,
        poolSize: quiz.questions.length,
        questionsPerSession: quiz.questionsPerSession,
      })),
      {
        name: 'final',
        poolSize: content.finalTest.questions.length,
        questionsPerSession: content.finalTest.questionsPerSession,
      },
    ]),
  ];
}
