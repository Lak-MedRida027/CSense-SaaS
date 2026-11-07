import { Types, trusted } from 'mongoose';
import type {
  AuditAction,
  AuditOutcome,
  AuditSeverity,
  AuditTargetType,
  Role,
} from '@csense/shared';
import { Mutex } from '../../lib/mutex.js';
import { AuditLog, GENESIS_HASH } from '../../models/AuditLog.js';
import { canonicalEntry, hmacHex, type ChainFields } from './chain.js';

/** Request-derived context attached to audit entries. */
export interface AuditContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

export interface AuditRecordInput {
  action: AuditAction;
  outcome: AuditOutcome;
  severity?: AuditSeverity;
  actor?: { id: string | Types.ObjectId; role: Role } | null;
  target?: { type: AuditTargetType; id: string | Types.ObjectId } | null;
  ctx?: AuditContext;
  metadata?: Record<string, unknown>;
  /** A second write with the same key returns the first entry instead of adding another. */
  idempotencyKey?: string;
}

export interface AuditRecordResult {
  id: string;
  seq: number;
  /** True when the idempotency key already existed and nothing was written. */
  duplicate: boolean;
}

export interface AuditService {
  record(input: AuditRecordInput): Promise<AuditRecordResult>;
}

const SECRET_KEY = /pass|token|secret|hash/i;

/** Drops secret-looking keys at any depth. Values are never inspected, only key names. */
export function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    return depth > 4 ? [] : value.map((v) => sanitizeMetadata(v, depth + 1));
  }
  if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
    if (depth > 4) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (!SECRET_KEY.test(k)) out[k] = sanitizeMetadata(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Reduce metadata to plain JSON (ADR 0012): Dates become ISO strings, undefined object values are
 * dropped, and anything that cannot be hashed identically after a database round trip is refused.
 */
export function toJsonValue(value: unknown): unknown {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Types.ObjectId) return value.toHexString();
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('audit metadata numbers must be finite');
      return value;
    case 'object': {
      if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : toJsonValue(v)));
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        if (v !== undefined) out[k] = toJsonValue(v);
      }
      return out;
    }
    default:
      throw new TypeError('audit metadata must be JSON values');
  }
}

const toHex = (id: string | Types.ObjectId): string =>
  (typeof id === 'string' ? new Types.ObjectId(id) : id).toHexString();

const isDuplicateKey = (
  err: unknown,
): err is { code: 11000; keyPattern?: Record<string, unknown> } =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;

const MAX_SEQ_RETRIES = 10;
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Writers in this process share one mutex unless a test hands in its own. */
const processMutex = new Mutex();

export interface AuditServiceDeps {
  chainSecret: string;
  clock?: () => Date;
  mutex?: Mutex;
}

/**
 * The only writer of the audit log (ADR 0012). Under a mutex it reads the chain tip, builds the
 * next entry (seq, prevHash, HMAC) and inserts it. Another process winning the same `seq` is
 * handled by re-reading the tip and retrying.
 */
export function createAuditService(deps: AuditServiceDeps): AuditService {
  const clock = deps.clock ?? (() => new Date());
  const mutex = deps.mutex ?? processMutex;

  const existing = async (key: string): Promise<AuditRecordResult | null> => {
    const found = await AuditLog.findOne({ idempotencyKey: key }).select('seq').lean();
    return found ? { id: found._id.toHexString(), seq: found.seq ?? 0, duplicate: true } : null;
  };

  return {
    async record(input) {
      const key = input.idempotencyKey ?? null;
      if (key !== null) {
        const prior = await existing(key);
        if (prior) return prior;
      }
      const base: Omit<ChainFields, 'seq' | 'prevHash'> = {
        createdAt: clock(),
        action: input.action,
        outcome: input.outcome,
        severity: input.severity ?? 'info',
        actorId: input.actor ? toHex(input.actor.id) : null,
        actorRole: input.actor?.role ?? null,
        targetType: input.target?.type ?? null,
        targetId: input.target ? toHex(input.target.id) : null,
        ip: input.ctx?.ip?.slice(0, 64) ?? null,
        userAgent: input.ctx?.userAgent?.slice(0, 256) ?? null,
        requestId: input.ctx?.requestId?.slice(0, 64) ?? null,
        idempotencyKey: key,
        metadata: toJsonValue(sanitizeMetadata(input.metadata ?? {})),
      };

      return mutex.run(async () => {
        for (let attempt = 0; attempt < MAX_SEQ_RETRIES; attempt += 1) {
          const tip = await AuditLog.findOne({ seq: trusted({ $exists: true }) })
            .sort({ seq: -1 })
            .select('seq hash')
            .lean();
          const seq = (tip?.seq ?? 0) + 1;
          const prevHash = tip?.hash ?? GENESIS_HASH;
          const fields: ChainFields = { ...base, seq, prevHash };
          const hash = hmacHex(deps.chainSecret, canonicalEntry(fields));
          try {
            const doc = await AuditLog.create({
              seq,
              prevHash,
              hash,
              idempotencyKey: key,
              action: input.action,
              outcome: input.outcome,
              severity: input.severity ?? 'info',
              actorId: fields.actorId === null ? null : new Types.ObjectId(fields.actorId),
              actorRole: input.actor?.role ?? null,
              targetType: input.target?.type ?? null,
              targetId: fields.targetId === null ? null : new Types.ObjectId(fields.targetId),
              ip: fields.ip,
              userAgent: fields.userAgent,
              requestId: fields.requestId,
              metadata: fields.metadata,
              createdAt: fields.createdAt,
            });
            return { id: String(doc._id), seq, duplicate: false };
          } catch (err) {
            if (!isDuplicateKey(err)) throw err;
            const pattern = err.keyPattern ?? {};
            if (key !== null && 'idempotencyKey' in pattern) {
              const prior = await existing(key);
              if (prior) return prior;
            }
            if (!('seq' in pattern)) throw err;
            // Another writer took this seq: back off a little, re-read the tip and try again.
            await sleep(Math.random() * 5 * (attempt + 1));
          }
        }
        throw new Error('Audit log is busy: could not append after several attempts');
      });
    },
  };
}

let current: AuditService | null = null;

/** Bind the service the module-level `audit` facade uses (app start, CLIs, test setup). */
export function configureAudit(service: AuditService): void {
  current = service;
}

/** Facade used by call sites. Fails closed when no service is bound. */
export const audit: AuditService = {
  record: (input) => {
    if (current === null) {
      return Promise.reject(new Error('Audit service is not configured'));
    }
    return current.record(input);
  },
};
