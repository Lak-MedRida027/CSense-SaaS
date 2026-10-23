import { Schema, model, type InferSchemaType } from 'mongoose';
import { ASSESSMENT_KINDS, DEFAULT_PASSING_SCORE } from '@csense/shared';
import { questionSchema } from './schemas/question.schema.js';
import { baseSchemaOptions, intValidator } from './schemaOptions.js';

/**
 * Class UML: abstract Assessment with Quiz and FinalTest subclasses.
 * One `assessments` collection, discriminator key `kind` (decision U2; `kind` is NOT in the diagram).
 */
const assessmentSchema = new Schema(
  {
    kind: { type: String, enum: ASSESSMENT_KINDS, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    questions: {
      type: [questionSchema],
      validate: {
        validator: (v: unknown[]) => Array.isArray(v) && v.length >= 1,
        message: 'an assessment needs at least one question',
      },
    },
    // Integer percent 0-100, configurable per assessment (CLAUDE.md open question; default 70).
    passingScore: {
      type: Number,
      min: 0,
      max: 100,
      default: DEFAULT_PASSING_SCORE,
      validate: intValidator,
    },
  },
  { ...baseSchemaOptions, discriminatorKey: 'kind', collection: 'assessments' },
);

assessmentSchema.index({ kind: 1 });
// Module composes exactly one Quiz.
assessmentSchema.index(
  { moduleId: 1 },
  { unique: true, partialFilterExpression: { kind: 'Quiz' }, name: 'quiz_per_module_unique' },
);
// Only one FinalTest exists (decision U12).
assessmentSchema.index(
  { kind: 1 },
  { unique: true, partialFilterExpression: { kind: 'FinalTest' }, name: 'single_final_test' },
);

export type AssessmentDoc = InferSchemaType<typeof assessmentSchema>;
export const Assessment = model('Assessment', assessmentSchema);

export const Quiz = Assessment.discriminator(
  'Quiz',
  new Schema(
    { moduleId: { type: Schema.Types.ObjectId, ref: 'Module', required: true } },
    { strict: 'throw' },
  ),
  'Quiz',
);

export const FinalTest = Assessment.discriminator(
  'FinalTest',
  new Schema({}, { strict: 'throw' }),
  'FinalTest',
);
