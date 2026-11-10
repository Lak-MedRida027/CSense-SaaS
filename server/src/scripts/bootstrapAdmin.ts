import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { emailSchema, newPasswordSchema } from '@csense/shared';
import { toAppConfig } from '../config/appConfig.js';
import { loadEnv } from '../config/env.js';
import { connectDb, disconnectDb } from '../db/connect.js';
import { audit, configureAudit, createAuditService } from '../features/audit/audit.service.js';
import { hashPassword } from '../features/auth/password.js';
import { createLogger } from '../lib/logger.js';
import { Administrator, User } from '../models/index.js';

/**
 * First-administrator bootstrap (decision U20). Not an HTTP route: run it once from a shell.
 * It never generates or prints a password; remove BOOTSTRAP_ADMIN_PASSWORD from .env afterwards.
 */
export const bootstrapInputSchema = z.object({
  BOOTSTRAP_ADMIN_EMAIL: emailSchema,
  BOOTSTRAP_ADMIN_NAME: z.string().trim().min(1).max(120),
  BOOTSTRAP_ADMIN_PASSWORD: newPasswordSchema,
});

export type BootstrapResult = 'created' | 'skipped';

export interface BootstrapDeps {
  bcryptCost: number;
  log?: (message: string, fields?: Record<string, unknown>) => void;
}

const isDuplicateKey = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;

const SINGLE_ADMIN_INDEX = 'createdBy_1';

/**
 * The race guard is the unique partial index on `createdBy: null`. Autoindexing may be off or may
 * have failed on pre-existing duplicates, so build it explicitly and verify it, and refuse to run
 * without it (P2-L5).
 */
export async function assertSingleAdminIndex(): Promise<void> {
  let cause = '';
  try {
    await User.createIndexes();
  } catch (err) {
    cause = err instanceof Error ? ` (${err.message})` : '';
  }
  const present = (await User.collection.indexes()).some(
    (i) =>
      i.name === SINGLE_ADMIN_INDEX &&
      i.unique === true &&
      JSON.stringify(i.partialFilterExpression) ===
        JSON.stringify({ createdBy: { $type: 'null' } }),
  );
  if (!present) {
    throw new Error(
      `Refusing to bootstrap: the unique partial index "${SINGLE_ADMIN_INDEX}" on users.createdBy (null) is missing and could not be built${cause}. Resolve duplicate accounts without a creator, then rerun.`,
    );
  }
}

export async function bootstrapAdmin(
  rawInput: Record<string, string | undefined>,
  deps: BootstrapDeps,
): Promise<BootstrapResult> {
  const log = deps.log ?? (() => undefined);

  await assertSingleAdminIndex();

  // Idempotent: if any administrator exists, touch nothing (no reset, no update). This is the cheap
  // fast path; the unique partial index on `createdBy: null` is what makes it race-free.
  if (await Administrator.exists({})) {
    log('Administrator already exists; bootstrap skipped');
    return 'skipped';
  }

  const parsed = bootstrapInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    // Name the offending keys only, never their values.
    const keys = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(', ');
    throw new Error(`Invalid bootstrap input: ${keys}`);
  }
  const input = parsed.data;

  const passwordHash = await hashPassword(input.BOOTSTRAP_ADMIN_PASSWORD, deps.bcryptCost);
  const admin = new Administrator({
    name: input.BOOTSTRAP_ADMIN_NAME,
    email: input.BOOTSTRAP_ADMIN_EMAIL,
    passwordHash,
    createdBy: null,
  });
  // The only code path allowed to create an account without a creator.
  admin.$locals.bootstrap = true;
  try {
    await admin.save();
  } catch (err) {
    // Correctness against concurrent runs comes from the unique partial index on `createdBy: null`
    // (User model): the loser of the race fails the insert here. If an administrator exists now,
    // somebody else bootstrapped first, so this run is a no-op. Any other duplicate (for example
    // the email of an existing employee) is a real error and is rethrown.
    if (isDuplicateKey(err) && (await Administrator.exists({}))) {
      log('Administrator already exists; bootstrap skipped');
      return 'skipped';
    }
    throw err;
  }

  try {
    await audit.record({
      action: 'admin.bootstrapped',
      outcome: 'success',
      severity: 'critical',
      actor: null,
      target: { type: 'user', id: admin.id },
    });
  } catch (err) {
    await Administrator.collection.deleteOne({ _id: admin._id });
    throw err;
  }
  log('Bootstrap administrator created', { email: input.BOOTSTRAP_ADMIN_EMAIL });
  return 'created';
}

async function main(): Promise<void> {
  const env = loadEnv();
  const config = toAppConfig(env);
  const logger = createLogger(env.LOG_LEVEL);
  // The bootstrap audit entry joins the hash chain, so the script needs the same key as the API.
  configureAudit(createAuditService({ chainSecret: config.audit.chainSecret }));
  await connectDb(env.MONGODB_URI);
  try {
    const result = await bootstrapAdmin(process.env, {
      bcryptCost: config.bcryptCost,
      log: (message, fields) => {
        logger.info(fields ?? {}, message);
      },
    });
    logger.info({ result }, 'Bootstrap finished');
  } finally {
    await disconnectDb();
  }
}

// Run only when executed directly, not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    process.stderr.write(`Bootstrap failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
