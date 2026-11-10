import { Schema, model, type InferSchemaType } from 'mongoose';
import {
  MAX_EXERCISES,
  MAX_KEY_TAKEAWAYS,
  MAX_TRANSCRIPT_CUES,
  MODULE_FORMATS,
} from '@csense/shared';
import { baseSchemaOptions, intValidator } from './schemaOptions.js';
import { exerciseSchema } from './schemas/exercise.schema.js';

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

const urlField = {
  type: String,
  trim: true,
  validate: { validator: isHttpUrl, message: 'invalid URL' },
};

const maxLength = (max: number, what: string) => ({
  validator: (v: unknown[]) => Array.isArray(v) && v.length <= max,
  message: `at most ${String(max)} ${what}`,
});

const transcriptCueSchema = new Schema(
  {
    startSeconds: { type: Number, required: true, min: 0, validate: intValidator },
    text: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 },
  },
  { _id: false, strict: 'throw' },
);

/** Class UML: Module. `order` drives the sequential lock and is unique. */
const moduleSchema = new Schema(
  {
    order: { type: Number, required: true, min: 1, validate: intValidator },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, trim: true },
    // Plain-text lesson body: clients render it as text, never as HTML.
    content: { type: String, default: '' },
    videoUrl: urlField,
    captionsUrl: urlField,
    transcript: {
      type: [transcriptCueSchema],
      validate: maxLength(MAX_TRANSCRIPT_CUES, 'transcript cues'),
    },
    keyTakeaways: {
      type: [{ type: String, trim: true, minlength: 1, maxlength: 300 }],
      validate: maxLength(MAX_KEY_TAKEAWAYS, 'key takeaways'),
    },
    exercises: { type: [exerciseSchema], validate: maxLength(MAX_EXERCISES, 'exercises') },
    format: { type: String, enum: MODULE_FORMATS, required: true },
    // Minutes (decision U9).
    duration: { type: Number, required: true, min: 0, validate: intValidator },
    isPublished: { type: Boolean, default: false },
  },
  { ...baseSchemaOptions, collection: 'modules' },
);

moduleSchema.index({ order: 1 }, { unique: true });
moduleSchema.index({ isPublished: 1, order: 1 });

// Publish invariant: a published module must be playable.
interface PublishCheck {
  isPublished: boolean;
  format: string;
  videoUrl?: string | null;
  exercises: unknown[];
  invalidate(path: string, message: string): void;
}

moduleSchema.pre('validate', function (this: PublishCheck) {
  if (!this.isPublished) return;
  if (this.format === 'video' && !this.videoUrl) {
    this.invalidate('videoUrl', 'a published video module needs a videoUrl');
  }
  if (this.format === 'interactive' && this.exercises.length === 0) {
    this.invalidate('exercises', 'a published interactive module needs at least one exercise');
  }
});

export type ModuleDoc = InferSchemaType<typeof moduleSchema>;
export const Module = model('Module', moduleSchema);
