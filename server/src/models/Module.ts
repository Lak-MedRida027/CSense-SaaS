import { Schema, model, type InferSchemaType } from 'mongoose';
import { MODULE_FORMATS } from '@csense/shared';
import { baseSchemaOptions, intValidator } from './schemaOptions.js';

const isHttpUrl = (v: unknown): boolean => {
  if (v === undefined || v === null || v === '') return true;
  if (typeof v !== 'string') return false;
  try {
    const { protocol } = new URL(v);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};

/** Class UML: Module. `order` drives the sequential lock and is unique. */
const moduleSchema = new Schema(
  {
    order: { type: Number, required: true, min: 1, validate: intValidator },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, trim: true },
    content: { type: String, default: '' },
    videoUrl: {
      type: String,
      trim: true,
      validate: { validator: isHttpUrl, message: 'invalid URL' },
    },
    format: { type: String, enum: MODULE_FORMATS, required: true },
    // Minutes (decision U9).
    duration: { type: Number, required: true, min: 0, validate: intValidator },
    isPublished: { type: Boolean, default: false },
  },
  { ...baseSchemaOptions, collection: 'modules' },
);

moduleSchema.index({ order: 1 }, { unique: true });
moduleSchema.index({ isPublished: 1, order: 1 });

export type ModuleDoc = InferSchemaType<typeof moduleSchema>;
export const Module = model('Module', moduleSchema);
