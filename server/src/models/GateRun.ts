import { Schema, model, type InferSchemaType } from 'mongoose';
import {
  GATE_ATTEMPTS_MAX,
  GATE_ATTEMPTS_MIN,
  GATE_OPTION_MAX,
  GATE_RUN_STATUSES,
} from '@csense/shared';
import { baseSchemaOptions, intValidator } from './schemaOptions.js';

/** The challenge currently waiting for an answer. `correctAnswer` is the server-held key snapshot. */
const currentSchema = new Schema(
  {
    challengeId: { type: Schema.Types.ObjectId, required: true },
    questionId: { type: Schema.Types.ObjectId, ref: 'GateQuestion', required: true },
    // Snapshot of what was served, in the served (shuffled) order: the key below refers to it, and
    // a later edit of the question cannot change a challenge that is already out.
    prompt: { type: String, required: true, maxlength: 1000 },
    options: { type: [{ type: String, maxlength: 300 }], required: true },
    optionCount: {
      type: Number,
      required: true,
      min: 1,
      max: GATE_OPTION_MAX,
      validate: intValidator,
    },
    correctAnswer: {
      type: Number,
      required: true,
      min: 0,
      max: GATE_OPTION_MAX - 1,
      validate: intValidator,
      select: false,
    },
    servedAt: { type: Date, required: true },
  },
  { _id: false, strict: 'throw' },
);

/**
 * One pass-or-restrict episode of the security gate (ADR 0015). Mutable, but every change is a
 * compare-and-set on `status`, `current.challengeId` and `attemptsUsed`, so an answer is single
 * use and race safe. At most one run per employee is open (partial unique index).
 */
const gateRunSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: GATE_RUN_STATUSES, default: 'open' },
    maxAttempts: {
      type: Number,
      required: true,
      min: GATE_ATTEMPTS_MIN,
      max: GATE_ATTEMPTS_MAX,
      validate: intValidator,
    },
    attemptsUsed: { type: Number, default: 0, min: 0, validate: intValidator },
    current: { type: currentSchema, default: null },
    servedQuestionIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'GateQuestion' }],
      default: [],
      validate: {
        validator: (v: unknown[]) => v.length <= GATE_ATTEMPTS_MAX,
        message: `at most ${String(GATE_ATTEMPTS_MAX)} served questions`,
      },
    },
    firstAnswerCorrect: { type: Boolean, default: null },
    openedAt: { type: Date, required: true },
    closedAt: { type: Date, default: null },
    clearedUntil: { type: Date, default: null },
    escalationId: { type: Schema.Types.ObjectId, ref: 'Escalation', default: null },
    restoredAt: { type: Date, default: null },
    restoredBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    version: { type: Number, default: 0, min: 0, validate: intValidator },
  },
  {
    ...baseSchemaOptions,
    collection: 'gateruns',
    toJSON: {
      ...baseSchemaOptions.toJSON,
      transform: (_doc: unknown, ret: Record<string, unknown>) => {
        delete ret._id;
        const current = ret.current as Record<string, unknown> | null | undefined;
        if (current) delete current.correctAnswer;
        return ret;
      },
    },
  },
);

// One open run per employee: two concurrent "get or create" calls cannot both insert.
gateRunSchema.index(
  { userId: 1 },
  { unique: true, name: 'one_open_run', partialFilterExpression: { status: 'open' } },
);
gateRunSchema.index({ userId: 1, closedAt: -1 });
gateRunSchema.index({ userId: 1, status: 1, clearedUntil: -1 });
// Reconcile scan of restrictions that are not restored yet.
gateRunSchema.index({ status: 1, restoredAt: 1 });

export type GateRunDoc = InferSchemaType<typeof gateRunSchema>;
export const GateRun = model('GateRun', gateRunSchema);
