import { pathToFileURL } from 'node:url';
import { trusted } from 'mongoose';
import { toAppConfig } from '../config/appConfig.js';
import { loadEnv } from '../config/env.js';
import { connectDb, disconnectDb } from '../db/connect.js';
import {
  verifyChain,
  type ChainBreakReason,
  type ChainReport,
  type StoredChainEntry,
} from '../features/audit/chain.js';
import { audit, configureAudit, createAuditService } from '../features/audit/audit.service.js';
import { AuditLog, numericSeqFilter } from '../models/index.js';

/** A trusted operator object for a query value (the global sanitizeFilter would wrap it). */
const operators = (value: object): never => trusted(value) as never;

export type VerifyBreakReason = ChainBreakReason | 'unchained_after_chain' | 'non_numeric_seq';

export interface VerifyAuditResult extends Omit<ChainReport, 'firstBreak' | 'ok'> {
  ok: boolean;
  /** First problem found; `seq` is null for rows that have no usable sequence number. */
  firstBreak: { seq: number | null; reason: VerifyBreakReason } | null;
  /** Rows with no `seq` older than the first chained row: pre-Phase-4 development data. */
  unchainedLegacy: number;
  /** Rows with no `seq` written at or after the chain started. These are a break. */
  unchainedAfterChain: number;
  /** Rows whose `seq` is not a number. These are a break. */
  nonNumericSeq: number;
}

/**
 * Walk the chain from `fromSeq` (default 1) and report the first break, without writing. Besides
 * the chain itself it fails on rows the chain cannot vouch for: a non-numeric `seq`, and any row
 * with no `seq` that is dated at or after the first chained row (a forged or bypassing write).
 * Only older rows without a `seq` are tolerated, as legacy.
 */
export async function verifyAuditChain(opts: {
  secret: string;
  fromSeq?: number;
}): Promise<VerifyAuditResult> {
  const fromSeq = opts.fromSeq ?? 1;
  let anchorHash: string | undefined;
  if (fromSeq > 1) {
    const before = await AuditLog.findOne({ seq: fromSeq - 1 })
      .select('hash')
      .lean();
    if (before?.hash) anchorHash = before.hash;
  }
  const cursor = AuditLog.find({ seq: operators({ $type: 'number', $gte: fromSeq }) })
    .sort({ seq: 1 })
    .lean<StoredChainEntry[]>()
    .cursor();
  const report = await verifyChain(cursor, opts.secret, {
    fromSeq,
    ...(anchorHash ? { anchorHash } : {}),
  });

  const firstChained = await AuditLog.findOne({ seq: numericSeqFilter() })
    .sort({ seq: 1 })
    .select('createdAt')
    .lean();
  const unchained = operators({ $exists: false });
  const [unchainedAfterChain, unchainedLegacy, nonNumericSeq] = await Promise.all([
    firstChained
      ? AuditLog.countDocuments({
          seq: unchained,
          createdAt: operators({ $gte: firstChained.createdAt }),
        })
      : Promise.resolve(0),
    firstChained
      ? AuditLog.countDocuments({
          seq: unchained,
          createdAt: operators({ $lt: firstChained.createdAt }),
        })
      : AuditLog.countDocuments({ seq: unchained }),
    AuditLog.countDocuments({ seq: operators({ $exists: true, $not: { $type: 'number' } }) }),
  ]);

  const extra: VerifyAuditResult['firstBreak'] =
    nonNumericSeq > 0
      ? { seq: null, reason: 'non_numeric_seq' }
      : unchainedAfterChain > 0
        ? { seq: null, reason: 'unchained_after_chain' }
        : null;
  const firstBreak = report.firstBreak ?? extra;
  return {
    checked: report.checked,
    tipSeq: report.tipSeq,
    tipHash: report.tipHash,
    ok: report.ok && extra === null,
    firstBreak,
    unchainedLegacy,
    unchainedAfterChain,
    nonNumericSeq,
  };
}

/**
 * Verify, then record the result as an `audit.integrity_checked` entry carrying the tip sequence and
 * a digest of the tip hash, so a later run (or forwarded logs) can notice a truncated tail.
 */
export async function verifyAndRecord(opts: {
  secret: string;
  fromSeq?: number;
}): Promise<VerifyAuditResult> {
  const result = await verifyAuditChain(opts);
  await audit.record({
    action: 'audit.integrity_checked',
    outcome: result.ok ? 'success' : 'failure',
    severity: result.ok ? 'info' : 'critical',
    metadata: {
      ok: result.ok,
      tipSeq: result.tipSeq,
      // Named "digest": the audit sanitiser drops keys that look like secrets, hash included.
      tipDigest: result.tipHash,
      checked: result.checked,
      unchainedLegacy: result.unchainedLegacy,
      unchainedAfterChain: result.unchainedAfterChain,
      nonNumericSeq: result.nonNumericSeq,
      ...(result.firstBreak ? { firstBreak: result.firstBreak } : {}),
    },
  });
  return result;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const config = toAppConfig(env);
  const fromArg = process.argv.find((a) => a.startsWith('--from='));
  const fromSeq = fromArg ? Number(fromArg.slice('--from='.length)) : 1;
  if (!Number.isSafeInteger(fromSeq) || fromSeq < 1)
    throw new Error('--from must be a positive integer');
  configureAudit(createAuditService({ chainSecret: config.audit.chainSecret }));
  await connectDb(env.MONGODB_URI);
  try {
    const result = await verifyAndRecord({ secret: config.audit.chainSecret, fromSeq });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    await disconnectDb();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `Audit verification failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
