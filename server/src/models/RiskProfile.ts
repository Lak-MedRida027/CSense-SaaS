import { Schema, model, type InferSchemaType } from 'mongoose';
import { DIMENSION_COVERAGE, RISK_LEVELS, RISK_SCORE_MAX, RISK_SCORE_MIN } from '@csense/shared';
import { baseSchemaOptions, intValidator } from './schemaOptions.js';

/** Null means "not assessed" (D4-23): a missing score is never silently zero. */
const subScore = {
  type: Number,
  min: RISK_SCORE_MIN,
  max: RISK_SCORE_MAX,
  default: null,
  validate: intValidator,
};

const coverage = { type: String, enum: DIMENSION_COVERAGE, required: true };
const weight = { type: Number, min: 0, max: 10_000, required: true, validate: intValidator };
const count = { type: Number, min: 0, required: true, validate: intValidator };

const coverageSchema = new Schema(
  { knowledge: coverage, behavioural: coverage, simulation: coverage, engagement: coverage },
  { _id: false, strict: 'throw' },
);
const weightsSchema = new Schema(
  { knowledge: weight, behavioural: weight, simulation: weight, engagement: weight },
  { _id: false, strict: 'throw' },
);
export const evidenceSchema = new Schema(
  {
    attempts: count,
    firstAttempts: count,
    abandoned: count,
    expired: count,
    extraFailures: count,
    cooldowns: count,
    passedModules: count,
    curriculumSize: count,
    finalTestPassed: { type: Boolean, required: true },
    simulationOutcomes: count,
  },
  { _id: false, strict: 'throw' },
);

/**
 * Class UML: RiskProfile, aggregated by Employee ("has", 1:1). Derived state: the stored profile
 * always equals `computeRiskProfile` over the facts in the database (ADR 0010); `rev` is the
 * optimistic-concurrency counter of the recomputation.
 */
const riskProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    knowledgeScore: subScore,
    behaviouralScore: subScore,
    simulationScore: subScore,
    engagementScore: subScore,
    riskLevel: { type: String, enum: [...RISK_LEVELS, null], default: null },
    // Not in the UML: materialises computeComposite().
    compositeScore: subScore,
    coverage: { type: coverageSchema, default: null },
    effectiveWeightsBp: { type: weightsSchema, default: null },
    evidence: { type: evidenceSchema, default: null },
    modelVersion: { type: Number, min: 1, default: null, validate: intValidator },
    rev: { type: Number, min: 0, default: 0, validate: intValidator },
    lastAssessmentId: { type: Schema.Types.ObjectId, ref: 'RiskAssessment', default: null },
    // The assessment that moved the profile into High; null whenever the profile is not High.
    highEpisodeId: { type: Schema.Types.ObjectId, ref: 'RiskAssessment', default: null },
    computedAt: { type: Date, default: null },
  },
  { ...baseSchemaOptions, collection: 'riskprofiles' },
);

riskProfileSchema.index({ userId: 1 }, { unique: true });
riskProfileSchema.index({ riskLevel: 1 });
riskProfileSchema.index({ compositeScore: -1 });

export type RiskProfileDoc = InferSchemaType<typeof riskProfileSchema>;
export const RiskProfile = model('RiskProfile', riskProfileSchema);
