import { Schema, model, type InferSchemaType } from 'mongoose';
import { BADGE_NAME_MAX } from '@csense/shared';
import { baseSchemaOptions } from './schemaOptions.js';

/** Class UML: Badge --defines--> Module (1). One badge per module (decision U5). */
const badgeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: BADGE_NAME_MAX },
    moduleId: { type: Schema.Types.ObjectId, ref: 'Module', required: true },
    // Vocabulary is enforced by the shared badgeAuthoringSchema; the model only bounds the length.
    iconMotif: { type: String, required: true, trim: true, maxlength: 40 },
  },
  { ...baseSchemaOptions, collection: 'badges' },
);

badgeSchema.index({ moduleId: 1 }, { unique: true });

export type BadgeDoc = InferSchemaType<typeof badgeSchema>;
export const Badge = model('Badge', badgeSchema);
