import { Schema, model, type InferSchemaType } from 'mongoose';
import { RISK_LEVELS, RISK_SCORE_MAX, RISK_SCORE_MIN } from '@csense/shared';
import { appendOnly } from './plugins/appendOnly.js';
import { baseSchemaOptions, intValidator } from './schemaOptions.js';
import { evidenceSchema } from './RiskProfile.js';

export class RiskAssessmentImmutableError extends Error {
  readonly code = 'RISK_ASSESSMENT_IMMUTABLE';
  constructor(operation: string) {
    super(`RiskAssessment is append-only: ${operation} is not permitted`);
    this.name = 'RiskAssessmentImmutableError';
  }
}

export const RISK_TRIGGER_TYPES = [
  'attempt',
  'reconcile',
  'critical_event',
  'gate_run',
  'model_upgrade',
  'config_change',
] as const;

const score = {
  type: Number,
  min: RISK_SCORE_MIN,
  max: RISK_SCORE_MAX,
  default: null,
  validate: intValidator,
};
const cov = { type: String, enum: ['assessed', 'not_assessed', 'disabled'], required: true };
const weight = { type: Number, min: 0, max: 10_000, required: true, validate: intValidator };

/** History of every change to an employee risk profile (D4-24). Written only when something changed. */
const riskAssessmentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    profileRev: { type: Number, min: 1, required: true, validate: intValidator },
    modelVersion: { type: Number, min: 1, required: true, validate: intValidator },
    scores: {
      type: new Schema(
        { knowledge: score, behavioural: score, simulation: score, engagement: score },
        { _id: false, strict: 'throw' },
      ),
      required: true,
    },
    compositeScore: score,
    riskLevel: { type: String, enum: [...RISK_LEVELS, null], default: null },
    previousLevel: { type: String, enum: [...RISK_LEVELS, null], default: null },
    levelChanged: { type: Boolean, required: true },
    coverage: {
      type: new Schema(
        { knowledge: cov, behavioural: cov, simulation: cov, engagement: cov },
        { _id: false, strict: 'throw' },
      ),
      required: true,
    },
    effectiveWeightsBp: {
      type: new Schema(
        { knowledge: weight, behavioural: weight, simulation: weight, engagement: weight },
        { _id: false, strict: 'throw' },
      ),
      required: true,
    },
    evidence: { type: evidenceSchema, required: true },
    // SHA-256 of the canonical facts the result was computed from.
    inputsDigest: { type: String, match: /^[0-9a-f]{64}$/, required: true },
    trigger: {
      type: new Schema(
        {
          type: { type: String, enum: RISK_TRIGGER_TYPES, required: true },
          refId: { type: Schema.Types.ObjectId, default: null },
        },
        { _id: false, strict: 'throw' },
      ),
      required: true,
    },
    computedAt: { type: Date, required: true },
  },
  {
    ...baseSchemaOptions,
    collection: 'riskassessments',
    timestamps: { createdAt: true, updatedAt: false },
  },
);

riskAssessmentSchema.index({ userId: 1, computedAt: -1 });
riskAssessmentSchema.index({ levelChanged: 1, computedAt: -1 });

appendOnly(riskAssessmentSchema, (operation) => new RiskAssessmentImmutableError(operation));

export type RiskAssessmentDoc = InferSchemaType<typeof riskAssessmentSchema>;
export const RiskAssessment = model('RiskAssessment', riskAssessmentSchema);
