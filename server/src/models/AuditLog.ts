import { Schema, model, type InferSchemaType } from 'mongoose';
import {
  AUDIT_ACTIONS,
  AUDIT_OUTCOMES,
  AUDIT_SEVERITIES,
  AUDIT_TARGET_TYPES,
  ROLES,
} from '@csense/shared';
import { appendOnly } from './plugins/appendOnly.js';
import { baseSchemaOptions, intValidator } from './schemaOptions.js';

export const AUDIT_METADATA_MAX_BYTES = 2048;
export const HASH_PATTERN = /^[0-9a-f]{64}$/;
/** prevHash of the first chained entry. */
export const GENESIS_HASH = '0'.repeat(64);

export class AuditLogImmutableError extends Error {
  readonly code = 'AUDIT_LOG_IMMUTABLE';
  constructor(operation: string) {
    super(`AuditLog is append-only: ${operation} is not permitted`);
    this.name = 'AuditLogImmutableError';
  }
}

/**
 * Append-only, tamper-evident audit log (ADR 0005 and 0012). Every entry belongs to a keyed hash
 * chain: `seq` is dense and unique, `prevHash` is the previous entry hash, `hash` is the HMAC of
 * the entry. Only the audit service (features/audit) computes these. `createdAt` is set by the
 * service before hashing (no Mongoose timestamps, which could overwrite it).
 */
const auditLogSchema = new Schema(
  {
    seq: { type: Number, min: 1, validate: intValidator },
    prevHash: { type: String, match: HASH_PATTERN },
    hash: { type: String, match: HASH_PATTERN },
    idempotencyKey: { type: String, maxlength: 200, default: null },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    outcome: { type: String, enum: AUDIT_OUTCOMES, required: true },
    severity: { type: String, enum: AUDIT_SEVERITIES, default: 'info' },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorRole: { type: String, enum: [...ROLES, null], default: null },
    targetType: { type: String, enum: [...AUDIT_TARGET_TYPES, null], default: null },
    targetId: { type: Schema.Types.ObjectId, default: null },
    ip: { type: String, maxlength: 64, default: null },
    userAgent: { type: String, maxlength: 256, default: null },
    requestId: { type: String, maxlength: 64, default: null },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
      validate: {
        validator: (v: unknown): boolean =>
          Buffer.byteLength(JSON.stringify(v ?? {}), 'utf8') <= AUDIT_METADATA_MAX_BYTES,
        message: 'metadata exceeds 2 KB',
      },
    },
    createdAt: { type: Date, required: true },
  },
  {
    ...baseSchemaOptions,
    collection: 'auditlogs',
    timestamps: false,
    minimize: false,
  },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ targetId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
// Entries written before the chain existed have no seq, hence the partial filter (ADR 0012).
auditLogSchema.index(
  { seq: 1 },
  { unique: true, partialFilterExpression: { seq: { $exists: true } } },
);
auditLogSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);
auditLogSchema.index({ action: 1, seq: -1 });
auditLogSchema.index({ targetId: 1, seq: -1 });
auditLogSchema.index({ actorId: 1, seq: -1 });

/** A new entry must carry its place in the chain, so a direct `AuditLog.create` fails. */
auditLogSchema.pre(
  'validate',
  function (this: {
    isNew: boolean;
    seq?: number | null;
    prevHash?: string | null;
    hash?: string | null;
    invalidate: (path: string, message: string) => unknown;
  }) {
    if (!this.isNew) return;
    for (const path of ['seq', 'prevHash', 'hash'] as const) {
      if (this[path] == null) this.invalidate(path, `${path} is required (use the audit service)`);
    }
  },
);

/**
 * Immutability. Every update, replace and delete path throws, and so does `insertMany`: chain
 * entries are written one at a time by the service. This is model-level protection: the raw driver
 * or a DB user with write rights can still modify the collection, which is what the hash chain
 * detects (Phase 10: restrict the DB role to insert and find).
 */
appendOnly(auditLogSchema, (operation) => new AuditLogImmutableError(operation));
auditLogSchema.pre('insertMany', () => {
  throw new AuditLogImmutableError('insertMany');
});

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema>;
export const AuditLog = model('AuditLog', auditLogSchema);
