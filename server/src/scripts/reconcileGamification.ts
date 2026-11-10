import { pathToFileURL } from 'node:url';
import { toAppConfig } from '../config/appConfig.js';
import { loadEnv } from '../config/env.js';
import { connectDb, disconnectDb } from '../db/connect.js';
import { audit, configureAudit, createAuditService } from '../features/audit/audit.service.js';
import {
  createGamificationServices,
  type GamificationServices,
} from '../features/gamification/services.js';
import type { ReconcileDiff } from '../features/maintenance/reconcile.service.js';
import { createLogger } from '../lib/logger.js';

export interface ReconcileCliOptions {
  userId?: string;
  dryRun: boolean;
  forceXp: boolean;
  reason: 'reconcile' | 'model_upgrade' | 'config_change';
}

export interface ReconcileCliResult {
  users: number;
  drifted: number;
  diffs: ReconcileDiff[];
  /** 0 normally; 2 when a dry run found drift. */
  exitCode: 0 | 2;
}

/** Parse `--user <id>`, `--dry-run`, `--force-xp` and `--reason <name>`. Throws on anything else. */
export function parseReconcileArgs(argv: readonly string[]): ReconcileCliOptions {
  const opts: ReconcileCliOptions = { dryRun: false, forceXp: false, reason: 'reconcile' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--force-xp') opts.forceXp = true;
    else if (arg === '--user' || arg === '--reason') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      i += 1;
      if (arg === '--user') {
        if (!/^[0-9a-f]{24}$/i.test(value)) throw new Error('--user must be a 24-character hex id');
        opts.userId = value;
      } else if (value === 'model_upgrade' || value === 'config_change' || value === 'reconcile') {
        opts.reason = value;
      } else {
        throw new Error('--reason must be model_upgrade or config_change');
      }
    } else {
      throw new Error(`Unknown argument: ${String(arg)}`);
    }
  }
  return opts;
}

/** Run a reconcile and (unless it is a dry run) record it in the audit log. */
export async function runReconcile(
  services: Pick<GamificationServices, 'reconcile'>,
  opts: ReconcileCliOptions,
): Promise<ReconcileCliResult> {
  const run = {
    dryRun: opts.dryRun,
    forceXp: opts.forceXp,
    trigger: { type: opts.reason } as const,
  };
  let users = 0;
  let diffs: ReconcileDiff[] = [];
  if (opts.userId) {
    const diff = await services.reconcile.reconcileUser(opts.userId, run);
    users = 1;
    diffs = diff.drift ? [diff] : [];
  } else {
    const all = await services.reconcile.reconcileAll(run);
    users = all.users;
    diffs = all.diffs;
  }
  const result: ReconcileCliResult = {
    users,
    drifted: diffs.length,
    diffs,
    exitCode: opts.dryRun && diffs.length > 0 ? 2 : 0,
  };
  if (!opts.dryRun) {
    await audit.record({
      action: 'maintenance.reconcile_run',
      outcome: 'success',
      metadata: {
        scope: opts.userId ? 'user' : 'all',
        dryRun: false,
        forceXp: opts.forceXp,
        reason: opts.reason,
        counts: {
          users,
          drifted: diffs.length,
          badges: diffs.reduce((n, d) => n + d.badgesAwarded, 0),
          xpFixed: diffs.filter((d) => d.xpChanged).length,
          auditWritten: diffs.reduce((n, d) => n + d.auditWritten, 0),
        },
      },
    });
  }
  return result;
}

async function main(): Promise<void> {
  const opts = parseReconcileArgs(process.argv.slice(2));
  const env = loadEnv();
  const config = toAppConfig(env);
  const logger = createLogger(env.LOG_LEVEL);
  configureAudit(createAuditService({ chainSecret: config.audit.chainSecret }));
  await connectDb(env.MONGODB_URI);
  try {
    const services = createGamificationServices({ config, clock: () => new Date(), logger });
    const result = await runReconcile(services, opts);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.exitCode;
  } finally {
    await disconnectDb();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    process.stderr.write(`Reconcile failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
