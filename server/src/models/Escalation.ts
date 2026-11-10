import { Schema, model, type InferSchemaType } from 'mongoose';
import {
  ESCALATION_EVENTS_MAX,
  ESCALATION_EVENT_TYPES,
  ESCALATION_NOTE_MAX,
  ESCALATION_REASONS,
  ESCALATION_REFERENCE_MAX,
  ESCALATION_RESOLUTIONS,
  ESCALATION_REVIEW_TIERS,
  ESCALATION_SEVERITIES,
  ESCALATION_SOURCE_TYPES,
  ESCALATION_STATUSES,
  RISK_LEVELS,
  RISK_SCORE_MAX,
  RISK_SCORE_MIN,
  ROLES,
} from '@csense/shared';
import { baseSchemaOptions, intValidator } from './schemaOptions.js';

const nullableScore = {
  type: Number,
  min: RISK_SCORE_MIN,
  max: RISK_SCORE_MAX,
  default: null,
  validate: intValidator,
};
const level = { type: String, enum: [...RISK_LEVELS, null], default: null };
const dim = { type: String, enum: ['assessed', 'not_assessed', 'disabled'], required: true };

/** Snapshot of the risk state when the escalation was opened. */
const contextSchema = new Schema(
  {
    riskLevel: level,
    previousLevel: level,
    compositeScore: nullableScore,
    scores: {
      type: new Schema(
        {
          knowledge: nullableScore,
          behavioural: nullableScore,
          simulation: nullableScore,
          engagement: nullableScore,
        },
        { _id: false, strict: 'throw' },
      ),
      default: null,
    },
    coverage: {
      type: new Schema(
        { knowledge: dim, behavioural: dim, simulation: dim, engagement: dim },
        { _id: false, strict: 'throw' },
      ),
      default: null,
    },
    riskAssessmentId: { type: Schema.Types.ObjectId, default: null },
    modelVersion: { type: Number, default: null, validate: intValidator },
  },
  { _id: false, strict: 'throw' },
);

/**
 * Every state change and note. `audited` is the outbox flag (ADR 0011): false until the matching
 * audit entry (keyed by `escalation:<id>:event:<eventId>`) exists.
 */
const eventSchema = new Schema(
  {
    eventId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: ESCALATION_EVENT_TYPES, required: true },
    at: { type: Date, required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorRole: { type: String, enum: [...ROLES, null], default: null },
    fromStatus: { type: String, enum: [...ESCALATION_STATUSES, null], default: null },
    toStatus: { type: String, enum: [...ESCALATION_STATUSES, null], default: null },
    note: { type: String, maxlength: ESCALATION_NOTE_MAX, default: null },
    resolution: { type: String, enum: [...ESCALATION_RESOLUTIONS, null], default: null },
    refId: { type: Schema.Types.ObjectId, default: null },
    audited: { type: Boolean, default: false },
    // Resolved by the administrator who acknowledged it, where policy normally forbids that.
    sameAdmin: { type: Boolean, default: false },
  },
  { _id: false, strict: 'throw' },
);

/** Governance escalation (ADR 0011). Not in the Class UML; required by R2 and R3. */
const escalationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, enum: ESCALATION_REASONS, required: true },
    severity: { type: String, enum: ESCALATION_SEVERITIES, required: true },
    reviewTier: { type: String, enum: ESCALATION_REVIEW_TIERS, required: true },
    status: { type: String, enum: ESCALATION_STATUSES, default: 'open' },
    // True while open or acknowledged; the partial unique index keys on it.
    active: { type: Boolean, default: true },
    // Set for reasons that allow only one active escalation per employee and scope.
    scopeKey: { type: String, maxlength: 100, default: null },
    dedupeKey: { type: String, required: true, maxlength: 200 },
    context: { type: contextSchema, required: true },
    sourceRef: {
      type: new Schema(
        {
          type: { type: String, enum: ESCALATION_SOURCE_TYPES, required: true },
          id: { type: Schema.Types.ObjectId, required: true },
        },
        { _id: false, strict: 'throw' },
      ),
      required: true,
    },
    openedAt: { type: Date, required: true },
    acknowledgedAt: { type: Date, default: null },
    acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolution: { type: String, enum: [...ESCALATION_RESOLUTIONS, null], default: null },
    managementReference: { type: String, maxlength: ESCALATION_REFERENCE_MAX, default: null },
    events: {
      type: [eventSchema],
      default: [],
      validate: {
        validator: (v: unknown[]) => v.length <= ESCALATION_EVENTS_MAX,
        message: `at most ${String(ESCALATION_EVENTS_MAX)} events`,
      },
    },
    version: { type: Number, min: 0, default: 0, validate: intValidator },
    // Retriggers beyond the system-event budget are folded into these (no event, no growth).
    retriggerCount: { type: Number, min: 0, default: 0, validate: intValidator },
    lastRetriggeredAt: { type: Date, default: null },
    lastRetriggerRef: { type: Schema.Types.ObjectId, default: null },
  },
  { ...baseSchemaOptions, collection: 'escalations' },
);

escalationSchema.index({ dedupeKey: 1 }, { unique: true });
// At most one active escalation per employee and scope (a risk episode, an assessment).
escalationSchema.index(
  { userId: 1, scopeKey: 1 },
  {
    unique: true,
    name: 'active_scope_unique',
    partialFilterExpression: { active: true, scopeKey: { $type: 'string' } },
  },
);
escalationSchema.index({ status: 1, severity: 1, openedAt: -1 });
escalationSchema.index({ userId: 1, openedAt: -1 });
escalationSchema.index({ 'events.audited': 1 });

export type EscalationDoc = InferSchemaType<typeof escalationSchema>;
export const Escalation = model('Escalation', escalationSchema);
