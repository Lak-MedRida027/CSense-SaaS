import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions, intValidator } from './schemaOptions.js';

export const RECONCILE_REASONS = ['risk', 'xp', 'badge', 'escalation', 'audit'] as const;

/**
 * "This employee needs a reconcile": left by a failed hook or audit write, claimed and deleted by
 * the sweeper (ADR 0008, 0011). Not part of the domain model.
 */
const reconcileMarkerSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reasons: { type: [{ type: String, enum: RECONCILE_REASONS }], default: [] },
    // Claims so far. Never reset by a failure; at the sweeper limit the marker is parked.
    attempts: { type: Number, min: 0, default: 0, validate: intValidator },
    // Reasons whose repair kept failing: kept for operators, never re-queued automatically.
    parkedReasons: { type: [{ type: String, enum: RECONCILE_REASONS }], default: [] },
    // Exact idempotency keys of audit entries that failed to be written (most recent 20).
    auditKeys: { type: [{ type: String, maxlength: 200 }], default: [] },
    // Not claimable before this time (back-off after a failed reconcile).
    notBefore: { type: Date, default: null },
  },
  { ...baseSchemaOptions, collection: 'reconcilemarkers' },
);

reconcileMarkerSchema.index({ userId: 1 }, { unique: true });
reconcileMarkerSchema.index({ createdAt: 1 });

export type ReconcileMarkerDoc = InferSchemaType<typeof reconcileMarkerSchema>;
export const ReconcileMarker = model('ReconcileMarker', reconcileMarkerSchema);
