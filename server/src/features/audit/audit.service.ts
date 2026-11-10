import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import type { Logger } from 'pino';
import {
  isWellFormedString,
  type AuditAction,
  type AuditOutcome,
  type AuditSeverity,
  type AuditTargetType,
  type Role,
} from '@csense/shared';
import { Mutex, MutexTimeoutError } from '../../lib/mutex.js';
import {
  AuditLog,
  AuditWriteAbortedError,
  GENESIS_HASH,
  auditWriteContext,
  numericSeq,
  unchainedSeq,
} from '../../models/AuditLog.js';
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
  /**
   * When the event happened, for entries rebuilt after the fact (reconcile). Defaults to now. It is
   * hashed like any other field; only trusted server code sets it.
   */
  at?: Date;
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

const isPlainObject = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
};

/**
 * Drops secret-looking keys at any depth. Values are never inspected, only key names. Dates and
 * ObjectIds pass through untouched for `toJsonValue` to canonicalise; any other object that is not
 * plain (a Map, a class instance, a Buffer) is refused rather than walked.
 */
export function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    return depth > 4 ? [] : value.map((v) => sanitizeMetadata(v, depth + 1));
  }
  if (typeof value === 'object' && value !== null) {
    if (value instanceof Date || value instanceof Types.ObjectId) return value;
    if (!isPlainObject(value)) throw new TypeError('audit metadata must be plain JSON values');
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
 * Reduce metadata to plain JSON (ADR 0012): Dates become ISO strings, ObjectIds hex strings,
 * undefined object values are dropped, and anything that cannot be hashed identically after a
 * database round trip is refused (non-finite numbers, lone surrogates, non-plain objects).
 */
export function toJsonValue(value: unknown): unknown {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Types.ObjectId) return value.toHexString();
  switch (typeof value) {
    case 'string':
      if (!isWellFormedString(value)) {
        throw new TypeError('audit metadata strings must be well-formed Unicode');
      }
      return value;
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('audit metadata numbers must be finite');
      return value;
    case 'object': {
      if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : toJsonValue(v)));
      if (!isPlainObject(value)) throw new TypeError('audit metadata must be plain JSON values');
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        if (!isWellFormedString(k)) {
          throw new TypeError('audit metadata keys must be well-formed Unicode');
        }
        if (v !== undefined) out[k] = toJsonValue(v);
      }
      return out;
    }
    default:
      throw new TypeError('audit metadata must be JSON values');
  }
}

/** Request-derived text is normalised (a lone surrogate becomes U+FFFD) rather than refused. */
const contextText = (value: string | undefined, max: number): string | null =>
  value === undefined ? null : toWellFormed(value.slice(0, max));

function toWellFormed(value: string): string {
  if (isWellFormedString(value)) return value;
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    const next = value.charCodeAt(i + 1);
    if (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      out += value.slice(i, i + 2);
      i += 1;
    } else if (code >= 0xd800 && code <= 0xdfff) {
      out += '�';
    } else {
      out += value.charAt(i);
    }
  }
  return out;
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

/** One audit write (tip read plus insert) that takes longer than this is abandoned and fails. */
export const DEFAULT_WRITE_TIMEOUT_MS = 10_000;
/** After a timeout, how long to wait for the abandoned write to settle before looking up its outcome. */
const SETTLE_GRACE_MS = 1_000;

export interface AuditServiceDeps {
  chainSecret: string;
  clock?: () => Date;
  mutex?: Mutex;
  /** Per-write time limit while holding the mutex (default 10 s). */
  writeTimeoutMs?: number;
  /** Receives integrity errors (a planted row holding an idempotency key). */
  logger?: Logger;
}

/** The audit log holds something it should not: the write is refused rather than hidden. */
export class AuditIntegrityError extends Error {
  readonly code = 'AUDIT_INTEGRITY';
  constructor(message: string) {
    super(message);
    this.name = 'AuditIntegrityError';
  }
}

/**
 * The only writer of the audit log (ADR 0012). Under a mutex it reads the chain tip, builds the
 * next entry (seq, prevHash, HMAC) and inserts it. Another process winning the same `seq` is
 * handled by re-reading the tip and retrying.
 *
 * Every call has an idempotency key (the one supplied, or a generated one) so the true outcome of a
 * write that timed out can always be looked up. An abandoned write is cancelled: its signal is
 * checked before each insert and by the model, so it cannot land after the caller was told it failed.
 */
export function createAuditService(deps: AuditServiceDeps): AuditService {
  const clock = deps.clock ?? (() => new Date());
  const mutex = deps.mutex ?? processMutex;

  /** Only chained rows count: a planted unchained row holding the key is not a prior write. */
  const existing = async (key: string): Promise<AuditRecordResult | null> => {
    const found = await AuditLog.findOne({ idempotencyKey: key, seq: numericSeq() })
      .select('seq')
      .lean();
    return found ? { id: found._id.toHexString(), seq: found.seq ?? 0, duplicate: true } : null;
  };

  return {
    async record(input) {
      const supplied = input.idempotencyKey ?? null;
      const key = supplied ?? `auto:${randomUUID()}`;
      if (supplied !== null) {
        const prior = await existing(supplied);
        if (prior) return prior;
        if (await AuditLog.exists({ idempotencyKey: supplied, seq: unchainedSeq() })) {
          deps.logger?.error(
            { event: 'audit_integrity', idempotencyKey: supplied },
            'An unchained audit row holds an idempotency key; the write was refused',
          );
          throw new AuditIntegrityError('An unchained audit row holds this idempotency key');
        }
      }
      const base: Omit<ChainFields, 'seq' | 'prevHash'> = {
        createdAt: input.at ?? clock(),
        action: input.action,
        outcome: input.outcome,
        severity: input.severity ?? 'info',
        actorId: input.actor ? toHex(input.actor.id) : null,
        actorRole: input.actor?.role ?? null,
        targetType: input.target?.type ?? null,
        targetId: input.target ? toHex(input.target.id) : null,
        ip: contextText(input.ctx?.ip, 64),
        userAgent: contextText(input.ctx?.userAgent, 256),
        requestId: contextText(input.ctx?.requestId, 64),
        idempotencyKey: key,
        metadata: toJsonValue(sanitizeMetadata(input.metadata ?? {})),
      };

      const write = (signal: AbortSignal): Promise<AuditRecordResult> =>
        auditWriteContext.run({ signal }, async () => {
          // Re-read on every use: the signal can flip while an await is pending.
          const isAborted = (): boolean => signal.aborted;
          for (let attempt = 0; attempt < MAX_SEQ_RETRIES; attempt += 1) {
            if (isAborted()) throw new AuditWriteAbortedError();
            // Only numeric sequence numbers count: a planted row must not become the tip.
            const tip = await AuditLog.findOne({ seq: numericSeq() })
              .sort({ seq: -1 })
              .select('seq hash')
              .lean();
            const seq = (tip?.seq ?? 0) + 1;
            const prevHash = tip?.hash ?? GENESIS_HASH;
            const fields: ChainFields = { ...base, seq, prevHash };
            const hash = hmacHex(deps.chainSecret, canonicalEntry(fields));
            try {
              // Checked immediately before the insert; the model checks again when it validates.
              if (isAborted()) throw new AuditWriteAbortedError();
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
              if ('idempotencyKey' in pattern) {
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

      try {
        return await mutex.run(write, deps.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS);
      } catch (err) {
        if (!(err instanceof MutexTimeoutError)) throw err;
        // The caller must be told the truth. The write is cancelled (its signal is aborted), but an
        // insert already on the wire may have landed: wait briefly for it, then look it up by key.
        await Promise.race([err.settled, sleep(SETTLE_GRACE_MS)]);
        let landed: AuditRecordResult | null = null;
        try {
          landed = await existing(key);
        } catch {
          landed = null; // outcome unknown: fail closed with the timeout
        }
        if (landed) return { ...landed, duplicate: false };
        throw err;
      }
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
