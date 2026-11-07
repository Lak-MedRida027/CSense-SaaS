import { pathToFileURL } from 'node:url';
import { trusted } from 'mongoose';
import { toAppConfig } from '../config/appConfig.js';
import { loadEnv } from '../config/env.js';
import { connectDb, disconnectDb } from '../db/connect.js';
import { verifyChain, type ChainReport, type StoredChainEntry } from '../features/audit/chain.js';
import { audit, configureAudit, createAuditService } from '../features/audit/audit.service.js';
import { AuditLog } from '../models/index.js';

export interface VerifyAuditResult extends ChainReport {
  /** Entries written before the chain existed (no seq); development data only. */
  unchainedLegacy: number;
}

/** Walk the chain from `fromSeq` (default 1) and report the first break, without writing. */
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
  const cursor = AuditLog.find({ seq: trusted({ $gte: fromSeq }) })
    .sort({ seq: 1 })
    .lean<StoredChainEntry[]>()
    .cursor();
  const report = await verifyChain(cursor, opts.secret, {
    fromSeq,
    ...(anchorHash ? { anchorHash } : {}),
  });
  const unchainedLegacy = await AuditLog.countDocuments({ seq: trusted({ $exists: false }) });
  return { ...report, unchainedLegacy };
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
