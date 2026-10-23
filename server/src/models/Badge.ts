import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions } from './schemaOptions.js';

/** Class UML: Badge --defines--> Module (1). One badge per module (decision U5). */
const badgeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    moduleId: { type: Schema.Types.ObjectId, ref: 'Module', required: true },
    iconMotif: { type: String, required: true, trim: true },
  },
  { ...baseSchemaOptions, collection: 'badges' },
);

badgeSchema.index({ moduleId: 1 }, { unique: true });

export type BadgeDoc = InferSchemaType<typeof badgeSchema>;
export const Badge = model('Badge', badgeSchema);
