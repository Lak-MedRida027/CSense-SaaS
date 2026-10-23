import { Schema, model, type InferSchemaType } from 'mongoose';
import { ASSESSMENT_KINDS } from '@csense/shared';
import { baseSchemaOptions, intValidator } from './schemaOptions.js';

/** `Answer` is undefined in the Class UML; shape fixed by decision U3. */
const answerSchema = new Schema(
  {
    questionId: { type: Schema.Types.ObjectId, required: true },
    selectedIndex: { type: Number, required: true, min: 0, validate: intValidator },
    correct: { type: Boolean, required: true },
  },
  { _id: false, strict: 'throw' },
);

/**
 * Class UML: QuizAttempt --submitted to--> Assessment (1). Append-only record of every attempt.
 * `type` holds the Assessment discriminator model name, so `refId` resolves via `refPath`.
 */
const quizAttemptSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ASSESSMENT_KINDS, required: true },
    refId: { type: Schema.Types.ObjectId, refPath: 'type', required: true },
    answers: { type: [answerSchema], required: true },
    score: { type: Number, required: true, min: 0, max: 100, validate: intValidator },
    passed: { type: Boolean, required: true },
  },
  {
    ...baseSchemaOptions,
    collection: 'quizattempts',
    timestamps: { createdAt: 'attemptedAt', updatedAt: false },
  },
);

quizAttemptSchema.index({ userId: 1, refId: 1, attemptedAt: -1 });
quizAttemptSchema.index({ refId: 1, passed: 1 });

export type QuizAttemptDoc = InferSchemaType<typeof quizAttemptSchema>;
export const QuizAttempt = model('QuizAttempt', quizAttemptSchema);
