import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import mongoose, { Types } from 'mongoose';
import { toAppConfig, type AppConfig } from '../config/appConfig.js';
import { loadEnv } from '../config/env.js';
import { createApp } from '../app.js';
import { ensureLearningIndexes } from '../db/learningIndexes.js';
import { configureAudit, createAuditService } from '../features/audit/audit.service.js';
import { hashPassword } from '../features/auth/password.js';
import type { Shuffle } from '../features/learning/shuffle.js';
import { createLogger } from '../lib/logger.js';
import { Administrator, Employee, GateQuestion, Module, UserProgress } from '../models/index.js';
import { bootstrapAdmin } from '../scripts/bootstrapAdmin.js';
import { SEED_GATE_QUESTIONS } from '../scripts/seed/gateContent.js';
import { seedBadges } from '../scripts/seedBadges.js';
import { seedGateContent } from '../scripts/seedGate.js';
import { seedLearningContent } from '../scripts/seedLearning.js';

/**
 * TEST-ONLY backend for the Electron end-to-end suite (ADR 0018, plan 12.4). It is compiled with
 * the server but can never start in production: it needs NODE_ENV=test AND CSENSE_E2E_HARNESS=1,
 * and it imports `mongodb-memory-server`, a dev dependency that is absent from production installs.
 * `createApp` never reads CSENSE_E2E_HARNESS; only this file does.
 *
 * It prints ONE JSON line to stdout when ready:
 *   { baseUrl, origin, accounts, gateKey, gateKeyText }
 * and answers GET <origin>/__harness/requests with { count } (requests the API has handled).
 * `gateKey` (prompt -> index of the correct option) exists only in this test process output. The
 * harness serves options in stored order (identity shuffle) so the index is valid for the UI.
 * It stops on SIGTERM, SIGINT or when stdin closes.
 */
export class HarnessRefusedError extends Error {
  constructor(reason: string) {
    super(`Refusing to start the e2e harness: ${reason}`);
    this.name = 'HarnessRefusedError';
  }
}

/** Fails closed: both variables must be set exactly. */
export function assertHarnessEnabled(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== 'test') {
    throw new HarnessRefusedError('NODE_ENV must be "test".');
  }
  if (env.CSENSE_E2E_HARNESS !== '1') {
    throw new HarnessRefusedError('CSENSE_E2E_HARNESS must be "1".');
  }
}

export interface HarnessAccount {
  email: string;
  password: string;
}

export interface HarnessAccounts {
  admin: HarnessAccount;
  admin2: HarnessAccount;
  'gate-pass': HarnessAccount;
  'gate-fail': HarnessAccount;
  quiz: HarnessAccount;
}

export interface HarnessReady {
  /** Ends with /api/v1, the shape the desktop API URL policy requires. */
  baseUrl: string;
  origin: string;
  accounts: HarnessAccounts;
  /** Gate prompt -> index of the correct option (options are served in stored order). */
  gateKey: Record<string, number>;
  /** Gate prompt -> text of the correct option. */
  gateKeyText: Record<string, string>;
}

export interface RunningHarness extends HarnessReady {
  /** Requests the API server has handled (the security spec asserts "zero requests"). */
  requestCount: () => number;
  stop: () => Promise<void>;
}

const secret = (): string => randomBytes(48).toString('base64url');
const password = (): string => `Pw-${randomBytes(12).toString('base64url')}`;
const identityShuffle: Shuffle = <T>(items: readonly T[]): T[] => [...items];

/** The config the harness runs with: random secrets per run, limits that keep specs deterministic. */
export function harnessConfig(): AppConfig {
  const env = loadEnv({
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/csense-e2e',
    LOG_LEVEL: 'silent',
    JWT_ACCESS_SECRET: secret(),
    REFRESH_TOKEN_SECRET: secret(),
    AUDIT_CHAIN_SECRET: secret(),
    BCRYPT_COST: '12',
    AUTH_FAILED_LOGIN_MIN_MS: '0',
    RATE_LIMIT_MAX: '100000',
    AUTH_LOGIN_MAX_PER_ACCOUNT_IP: '1000',
    AUTH_LOGIN_MAX_PER_IP: '1000',
    // Plan 12.5: keeps the lockdown spec deterministic.
    ASSESSMENT_COOLDOWN_AFTER_FAILS: '10',
    SESSION_START_RATE_MAX: '50',
    ASSESSMENT_START_REUSE_SECONDS: '0',
    // Specs poll often; the sweeper is not needed.
    RECONCILE_SWEEP_INTERVAL: '0',
  });
  return toAppConfig(env);
}

async function createAccounts(config: AppConfig): Promise<{
  accounts: HarnessAccounts;
  quizUserId: string;
}> {
  const hash = (pw: string): Promise<string> => hashPassword(pw, config.bcryptCost);
  const accounts: HarnessAccounts = {
    admin: { email: 'admin@e2e.example.com', password: password() },
    admin2: { email: 'admin2@e2e.example.com', password: password() },
    'gate-pass': { email: 'gate-pass@e2e.example.com', password: password() },
    'gate-fail': { email: 'gate-fail@e2e.example.com', password: password() },
    quiz: { email: 'quiz@e2e.example.com', password: password() },
  };

  // The real bootstrap path: the only code that may create an account without a creator.
  const result = await bootstrapAdmin(
    {
      BOOTSTRAP_ADMIN_EMAIL: accounts.admin.email,
      BOOTSTRAP_ADMIN_NAME: 'E2E Administrator',
      BOOTSTRAP_ADMIN_PASSWORD: accounts.admin.password,
    },
    { bcryptCost: config.bcryptCost },
  );
  if (result !== 'created') throw new Error('The e2e database already had an administrator');
  const admin = await Administrator.findOne({ email: accounts.admin.email }).select('_id').lean();
  if (!admin) throw new Error('bootstrap administrator missing');

  // A second administrator for separation of duties (acknowledge versus resolve).
  await Administrator.create({
    name: 'E2E Second Administrator',
    email: accounts.admin2.email,
    passwordHash: await hash(accounts.admin2.password),
    createdBy: admin._id,
  });

  const employee = async (key: 'gate-pass' | 'gate-fail' | 'quiz', name: string) =>
    Employee.create({
      name,
      email: accounts[key].email,
      passwordHash: await hash(accounts[key].password),
      createdBy: admin._id,
    });
  await employee('gate-pass', 'Gate Pass');
  await employee('gate-fail', 'Gate Fail');
  const quiz = await employee('quiz', 'Quiz Taker');
  return { accounts, quizUserId: quiz.id };
}

/** Module 1 content completed for the quiz employee, exercises answered, so its quiz can start. */
async function completeFirstModule(userId: string): Promise<void> {
  const first = await Module.findOne({ order: 1 })
    .select('exercises.exerciseId exercises.options +exercises.correctAnswer')
    .lean<{
      _id: Types.ObjectId;
      exercises: { exerciseId: Types.ObjectId; correctAnswer: number }[];
    }>();
  if (!first) throw new Error('seed did not create module 1');
  const now = new Date();
  await UserProgress.create({
    userId: new Types.ObjectId(userId),
    moduleId: first._id,
    status: 'in_progress',
    startedAt: now,
    contentCompletedAt: now,
    exerciseAnswers: first.exercises.map((e) => ({
      exerciseId: e.exerciseId,
      selectedIndex: e.correctAnswer,
      correct: true,
      answeredAt: now,
    })),
  });
}

/** The answer key by prompt, read from the database after seeding (test-only). */
async function gateKeys(): Promise<{
  gateKey: Record<string, number>;
  gateKeyText: Record<string, string>;
}> {
  const rows = await GateQuestion.find({ isActive: true })
    .select('prompt options +correctAnswer')
    .lean<{ prompt: string; options: string[]; correctAnswer: number }[]>();
  const gateKey: Record<string, number> = {};
  const gateKeyText: Record<string, string> = {};
  for (const r of rows) {
    gateKey[r.prompt] = r.correctAnswer;
    gateKeyText[r.prompt] = r.options[r.correctAnswer] ?? '';
  }
  if (Object.keys(gateKey).length !== SEED_GATE_QUESTIONS.length) {
    throw new Error('gate seed incomplete');
  }
  return { gateKey, gateKeyText };
}

/**
 * Seed everything and start the API on 127.0.0.1 with an OS-assigned port. The database must
 * already be connected (the caller owns the memory server). Exported for the harness unit test.
 */
export async function provisionHarness(): Promise<RunningHarness> {
  const config = harnessConfig();
  configureAudit(createAuditService({ chainSecret: config.audit.chainSecret }));
  await ensureLearningIndexes();
  await seedLearningContent({ nodeEnv: 'test' });
  await seedBadges({ nodeEnv: 'test' });
  await seedGateContent({ nodeEnv: 'test' });
  const { accounts, quizUserId } = await createAccounts(config);
  await completeFirstModule(quizUserId);
  const keys = await gateKeys();

  const app = await createApp({
    logger: createLogger('silent'),
    config,
    shuffle: identityShuffle,
  });
  let requests = 0;
  const server: Server = createServer((req, res) => {
    // Harness-only endpoint, answered before the app (it is not an API route): lets the security
    // spec assert that a refused configuration made zero requests.
    if (req.url === '/__harness/requests') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ count: requests }));
      return;
    }
    requests += 1;
    app(req, res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${String(port)}`;
  return {
    baseUrl: `${origin}/api/v1`,
    origin,
    accounts,
    ...keys,
    requestCount: () => requests,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}

async function main(): Promise<void> {
  assertHarnessEnabled(process.env);
  // Dynamic import: a dev dependency, absent from production installs.
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { serverSelectionTimeoutMS: 10_000 });
  const harness = await provisionHarness();

  let stopping = false;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    void harness
      .stop()
      .then(() => mongoose.disconnect())
      .then(() => mongod.stop())
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.stdin.on('end', shutdown);
  process.stdin.on('close', shutdown);
  process.stdin.resume();

  const ready: HarnessReady = {
    baseUrl: harness.baseUrl,
    origin: harness.origin,
    accounts: harness.accounts,
    gateKey: harness.gateKey,
    gateKeyText: harness.gateKeyText,
  };
  process.stdout.write(`${JSON.stringify(ready)}\n`);
}

// Run only when executed directly, not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `e2e harness failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
