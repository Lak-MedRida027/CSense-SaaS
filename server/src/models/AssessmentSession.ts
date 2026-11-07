import { Schema, model, type InferSchemaType } from 'mongoose';
import { ASSESSMENT_KINDS, MAX_OPTIONS, SESSION_STATUSES } from '@csense/shared';
import { baseSchemaOptions, intValidator } from './schemaOptions.js';

/** Closed sessions stay for 30 days past expiry (investigations), then Mongo removes them. */
export const SESSION_RETENTION_SECONDS = 30 * 24 * 60 * 60;

/** One served question with a snapshot of its key. The key is never selected or serialised. */
const servedQuestionSchema = new Schema(
  {
    questionId: { type: Schema.Types.ObjectId, required: true },
    optionCount: { type: Number, required: true, min: 2, max: MAX_OPTIONS, validate: intValidator },
    correctAnswer: {
      type: Number,
      required: true,
      min: 0,
      max: MAX_OPTIONS - 1,
      select: false,
      validate: intValidator,
    },
  },
  { _id: false, strict: 'throw' },
);

/**
 * Server-issued assessment session (ADR 0007; not in the Class UML). Grading uses this snapshot, so
 * later content edits cannot change how an open session is graded.
 */
const assessmentSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ASSESSMENT_KINDS, required: true },
    assessmentId: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true },
    moduleId: {
      type: Schema.Types.ObjectId,
      ref: 'Module',
      default: null,
      validate: {
        validator(this: { kind?: string }, v: unknown): boolean {
          return this.kind !== 'Quiz' || v !== null;
        },
        message: 'a Quiz session needs a moduleId',
      },
    },
    status: { type: String, enum: SESSION_STATUSES, default: 'open' },
    // Served order (shuffled).
    questions: {
      type: [servedQuestionSchema],
      validate: {
        validator: (v: unknown[]) => Array.isArray(v) && v.length >= 1,
        message: 'a session serves at least one question',
      },
    },
    // Allocated atomically at start from the per-(user, assessment) counter. Null only for sessions
    // planted outside the API; the attempt then takes a fresh number when it is recorded.
    attemptNumber: { type: Number, default: null, min: 1, validate: intValidator },
    passingScore: { type: Number, required: true, min: 0, max: 100, validate: intValidator },
    expiresAt: { type: Date, required: true },
    closedAt: { type: Date, default: null },
  },
  {
    ...baseSchemaOptions,
    collection: 'assessmentsessions',
    timestamps: { createdAt: 'startedAt', updatedAt: false } as const,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc: unknown, ret: Record<string, unknown>) => {
        delete ret._id;
        delete ret.questions; // Keys must never be serialised.
        return ret;
      },
    },
  },
);

// At most one open session per employee and assessment.
assessmentSessionSchema.index(
  { userId: 1, assessmentId: 1 },
  { unique: true, partialFilterExpression: { status: 'open' }, name: 'one_open_session' },
);
assessmentSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: SESSION_RETENTION_SECONDS });

export type AssessmentSessionDoc = InferSchemaType<typeof assessmentSessionSchema>;
export const AssessmentSession = model('AssessmentSession', assessmentSessionSchema);
