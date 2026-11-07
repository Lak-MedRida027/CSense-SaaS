import { Schema, model, type InferSchemaType } from 'mongoose';
import {
  AUDIT_ACTIONS,
  AUDIT_OUTCOMES,
  AUDIT_SEVERITIES,
  AUDIT_TARGET_TYPES,
  ROLES,
} from '@csense/shared';
import { rejectAggregateWrites } from './plugins/appendOnly.js';
import { baseSchemaOptions } from './schemaOptions.js';

export const AUDIT_METADATA_MAX_BYTES = 2048;

export class AuditLogImmutableError extends Error {
  readonly code = 'AUDIT_LOG_IMMUTABLE';
  constructor(operation: string) {
    super(`AuditLog is append-only: ${operation} is not permitted`);
    this.name = 'AuditLogImmutableError';
  }
}

const auditLogSchema = new Schema(
  {
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
  },
  {
    ...baseSchemaOptions,
    collection: 'auditlogs',
    // Append-only: there is no updatedAt.
    timestamps: { createdAt: true, updatedAt: false },
    minimize: false,
  },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ targetId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

/**
 * Immutability (ADR 0005). Every update, replace and delete path throws; only `create` and
 * `insertMany` write. This is model-level protection: the raw driver or a DB user with write rights
 * can still modify the collection (Phase 10: restrict the DB role to insert/find).
 */
const reject = (operation: string) => () => {
  throw new AuditLogImmutableError(operation);
};

auditLogSchema.pre('save', function (this: { isNew: boolean }) {
  if (!this.isNew) throw new AuditLogImmutableError('save on an existing document');
});

for (const op of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteMany',
  'findOneAndDelete',
] as const) {
  auditLogSchema.pre(op, reject(op));
}
// updateOne/deleteOne also exist on documents (doc.updateOne(), doc.deleteOne()).
auditLogSchema.pre('updateOne', { document: true, query: true }, reject('updateOne'));
auditLogSchema.pre('deleteOne', { document: true, query: true }, reject('deleteOne'));
auditLogSchema.pre('bulkWrite', reject('bulkWrite'));
rejectAggregateWrites(auditLogSchema, (operation) => new AuditLogImmutableError(operation));

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema>;
export const AuditLog = model('AuditLog', auditLogSchema);
