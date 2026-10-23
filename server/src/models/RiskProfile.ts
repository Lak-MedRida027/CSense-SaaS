import { Schema, model, type InferSchemaType } from 'mongoose';
import { RISK_LEVELS, RISK_SCORE_MAX, RISK_SCORE_MIN } from '@csense/shared';
import { baseSchemaOptions, intValidator } from './schemaOptions.js';

const subScore = {
  type: Number,
  min: RISK_SCORE_MIN,
  max: RISK_SCORE_MAX,
  default: RISK_SCORE_MIN, // Initial values are an open decision (U7).
  validate: intValidator,
};

/** Class UML: RiskProfile, aggregated by Employee ("has", 1:1). */
const riskProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    knowledgeScore: subScore,
    behaviouralScore: subScore,
    simulationScore: subScore,
    engagementScore: subScore,
    riskLevel: { type: String, enum: RISK_LEVELS, default: 'Low' },
  },
  { ...baseSchemaOptions, collection: 'riskprofiles' },
);

riskProfileSchema.index({ userId: 1 }, { unique: true });
riskProfileSchema.index({ riskLevel: 1 });

export type RiskProfileDoc = InferSchemaType<typeof riskProfileSchema>;
export const RiskProfile = model('RiskProfile', riskProfileSchema);
