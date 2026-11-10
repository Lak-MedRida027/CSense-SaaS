import { createHmac } from 'node:crypto';
import { GENESIS_HASH } from '../../models/AuditLog.js';

/** Version tag inside the hashed array, so the format can change without ambiguity. */
export const CHAIN_FORMAT_VERSION = 1;

export interface ChainFields {
  seq: number;
  prevHash: string;
  createdAt: Date;
  action: string;
  outcome: string;
  severity: string;
  actorId: string | null;
  actorRole: string | null;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  idempotencyKey: string | null;
  metadata: unknown;
}

/** JSON with object keys sorted recursively, so key order never changes a hash. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  const text = JSON.stringify(value) as string | undefined;
  return text ?? 'null';
}

/** The exact string that is hashed (ADR 0012): a fixed field order, metadata with sorted keys. */
export function canonicalEntry(f: ChainFields): string {
  return stableStringify([
    CHAIN_FORMAT_VERSION,
    f.seq,
    f.prevHash,
    f.createdAt.toISOString(),
    f.action,
    f.outcome,
    f.severity,
    f.actorId,
    f.actorRole,
    f.targetType,
    f.targetId,
    f.ip,
    f.userAgent,
    f.requestId,
    f.idempotencyKey,
    f.metadata,
  ]);
}

export function hmacHex(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

/** A stored entry as read for verification (lean). */
export interface StoredChainEntry {
  seq?: number | null | undefined;
  prevHash?: string | null | undefined;
  hash?: string | null | undefined;
  createdAt: Date;
  action: string;
  outcome: string;
  severity?: string | null | undefined;
  actorId?: { toHexString(): string } | null | undefined;
  actorRole?: string | null | undefined;
  targetType?: string | null | undefined;
  targetId?: { toHexString(): string } | null | undefined;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
  requestId?: string | null | undefined;
  idempotencyKey?: string | null | undefined;
  metadata?: unknown;
}

export function fieldsOf(e: StoredChainEntry): ChainFields {
  return {
    seq: e.seq ?? 0,
    prevHash: e.prevHash ?? '',
    createdAt: e.createdAt,
    action: e.action,
    outcome: e.outcome,
    severity: e.severity ?? 'info',
    actorId: e.actorId ? e.actorId.toHexString() : null,
    actorRole: e.actorRole ?? null,
    targetType: e.targetType ?? null,
    targetId: e.targetId ? e.targetId.toHexString() : null,
    ip: e.ip ?? null,
    userAgent: e.userAgent ?? null,
    requestId: e.requestId ?? null,
    idempotencyKey: e.idempotencyKey ?? null,
    metadata: e.metadata ?? {},
  };
}

export type ChainBreakReason = 'gap' | 'link_mismatch' | 'hash_mismatch' | 'missing_fields';

export interface ChainReport {
  ok: boolean;
  checked: number;
  tipSeq: number | null;
  tipHash: string | null;
  firstBreak: { seq: number; reason: ChainBreakReason } | null;
}

export interface VerifyOptions {
  /** Sequence number the walk starts at (default 1). */
  fromSeq?: number;
  /** Hash of the entry before `fromSeq`; defaults to the genesis value when starting at 1. */
  anchorHash?: string;
}

/**
 * Walk the chain in ascending `seq` order and report the first break: a missing sequence number
 * (deleted or reordered entry), a wrong link to the previous hash, or an entry whose recomputed
 * HMAC differs from the stored one (edited content or a different key).
 */
export async function verifyChain(
  entries: AsyncIterable<StoredChainEntry>,
  secret: string,
  opts: VerifyOptions = {},
): Promise<ChainReport> {
  let expectedSeq = opts.fromSeq ?? 1;
  let prevHash: string | null = opts.anchorHash ?? (expectedSeq === 1 ? GENESIS_HASH : null);
  let checked = 0;
  let tipSeq: number | null = null;
  let tipHash: string | null = null;

  const broken = (seq: number, reason: ChainBreakReason): ChainReport => ({
    ok: false,
    checked,
    tipSeq,
    tipHash,
    firstBreak: { seq, reason },
  });

  for await (const entry of entries) {
    if (entry.seq == null || entry.prevHash == null || entry.hash == null) {
      return broken(entry.seq ?? expectedSeq, 'missing_fields');
    }
    if (entry.seq !== expectedSeq) return broken(expectedSeq, 'gap');
    if (prevHash !== null && entry.prevHash !== prevHash) return broken(entry.seq, 'link_mismatch');
    const recomputed = hmacHex(secret, canonicalEntry(fieldsOf(entry)));
    if (recomputed !== entry.hash) return broken(entry.seq, 'hash_mismatch');
    checked += 1;
    tipSeq = entry.seq;
    tipHash = entry.hash;
    prevHash = entry.hash;
    expectedSeq += 1;
  }
  return { ok: true, checked, tipSeq, tipHash, firstBreak: null };
}
