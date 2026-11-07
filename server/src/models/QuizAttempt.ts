import { Schema, model, type InferSchemaType } from 'mongoose';
import { ASSESSMENT_KINDS, ATTEMPT_END_REASONS } from '@csense/shared';
import { appendOnly } from './plugins/appendOnly.js';
import { baseSchemaOptions, intValidator } from './schemaOptions.js';

export class QuizAttemptImmutableError extends Error {
  readonly code = 'QUIZ_ATTEMPT_IMMUTABLE';
  constructor(operation: string) {
    super(`QuizAttempt is append-only: ${operation} is not permitted`);
    this.name = 'QuizAttemptImmutableError';
  }
}

/** `Answer` is undefined in the Class UML; shape fixed by decision U3. `null` = left unanswered. */
const answerSchema = new Schema(
  {
    questionId: { type: Schema.Types.ObjectId, required: true },
    selectedIndex: { type: Number, default: null, min: 0, validate: intValidator },
    correct: { type: Boolean, required: true },
  },
  { _id: false, strict: 'throw' },
);

/**
 * Class UML: QuizAttempt --submitted to--> Assessment (1). Append-only record of every attempt
 * (submitted, abandoned or expired). `type` holds the Assessment discriminator model name, so
 * `refId` resolves via `refPath`. One entry in `answers` per served question, in served order.
 */
const quizAttemptSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ASSESSMENT_KINDS, required: true },
    refId: { type: Schema.Types.ObjectId, refPath: 'type', required: true },
    answers: { type: [answerSchema], required: true },
    score: { type: Number, required: true, min: 0, max: 100, validate: intValidator },
    passed: { type: Boolean, required: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'AssessmentSession', required: true },
    // Denormalised for filters; null for the FinalTest.
    moduleId: { type: Schema.Types.ObjectId, ref: 'Module', default: null },
    attemptNumber: { type: Number, required: true, min: 1, validate: intValidator },
    endReason: { type: String, enum: ATTEMPT_END_REASONS, required: true },
    correctCount: { type: Number, required: true, min: 0, validate: intValidator },
    totalCount: { type: Number, required: true, min: 1, validate: intValidator },
    // Snapshot of the threshold when the session started.
    passingScore: { type: Number, required: true, min: 0, max: 100, validate: intValidator },
  },
  {
    ...baseSchemaOptions,
    collection: 'quizattempts',
    timestamps: { createdAt: 'attemptedAt', updatedAt: false } as const,
  },
);

quizAttemptSchema.index({ userId: 1, refId: 1, attemptedAt: -1 });
quizAttemptSchema.index({ refId: 1, passed: 1 });
quizAttemptSchema.index({ sessionId: 1 }, { unique: true });
quizAttemptSchema.index({ userId: 1, attemptedAt: -1, _id: -1 });
quizAttemptSchema.index({ userId: 1, refId: 1, passed: 1 });
// Attempt numbers are allocated atomically at session start; a duplicate must never be stored.
quizAttemptSchema.index(
  { userId: 1, refId: 1, attemptNumber: 1 },
  { unique: true, name: 'attempt_number_unique' },
);

appendOnly(quizAttemptSchema, (operation) => new QuizAttemptImmutableError(operation));

export type QuizAttemptDoc = InferSchemaType<typeof quizAttemptSchema>;
export const QuizAttempt = model('QuizAttempt', quizAttemptSchema);
