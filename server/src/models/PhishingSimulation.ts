import { Schema, model, type InferSchemaType } from 'mongoose';
import { PHISHING_STATUSES } from '@csense/shared';
import { baseSchemaOptions } from './schemaOptions.js';

/** Class UML: PhishingSimulation (marked design/planned). Used only behind FEATURE_PHISHING. */
const phishingSimulationSchema = new Schema(
  {
    campaignName: { type: String, required: true, trim: true, maxlength: 200 },
    emailTemplate: { type: String, required: true },
    status: { type: String, enum: PHISHING_STATUSES, default: 'draft' },
    deployedAt: { type: Date },
    // NOT in diagram as an attribute: derived from the Administrator "configures" association.
    configuredBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { ...baseSchemaOptions, collection: 'phishingsimulations' },
);

phishingSimulationSchema.index({ status: 1 });

export type PhishingSimulationDoc = InferSchemaType<typeof phishingSimulationSchema>;
export const PhishingSimulation = model('PhishingSimulation', phishingSimulationSchema);
