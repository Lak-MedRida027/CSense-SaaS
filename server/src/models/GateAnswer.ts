import { Schema, model, type InferSchemaType } from 'mongoose';
import { GATE_ATTEMPTS_MAX, GATE_OPTION_MAX } from '@csense/shared';
import { appendOnly } from './plugins/appendOnly.js';
import { baseSchemaOptions, intValidator } from './schemaOptions.js';

export class GateAnswerImmutableError extends Error {
  readonly code = 'GATE_ANSWER_IMMUTABLE';
  constructor(operation: string) {
    super(`GateAnswer is append-only: ${operation} is not permitted`);
    this.name = 'GateAnswerImmutableError';
  }
}

/** One recorded gate answer: the record of truth for gate risk and gate XP (rebuildable). */
const gateAnswerSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    runId: { type: Schema.Types.ObjectId, ref: 'GateRun', required: true },
    attemptIndex: {
      type: Number,
      required: true,
      min: 1,
      max: GATE_ATTEMPTS_MAX,
      validate: intValidator,
    },
    challengeId: { type: Schema.Types.ObjectId, required: true },
    questionId: { type: Schema.Types.ObjectId, ref: 'GateQuestion', required: true },
    selectedIndex: {
      type: Number,
      required: true,
      min: 0,
      max: GATE_OPTION_MAX - 1,
      validate: intValidator,
    },
    correct: { type: Boolean, required: true },
    answeredAt: { type: Date, required: true },
  },
  {
    ...baseSchemaOptions,
    collection: 'gateanswers',
    timestamps: { createdAt: true, updatedAt: false },
  },
);

gateAnswerSchema.index({ runId: 1, attemptIndex: 1 }, { unique: true, name: 'run_attempt_unique' });
gateAnswerSchema.index({ userId: 1, answeredAt: -1 });

appendOnly(gateAnswerSchema, (operation) => new GateAnswerImmutableError(operation));

export type GateAnswerDoc = InferSchemaType<typeof gateAnswerSchema>;
export const GateAnswer = model('GateAnswer', gateAnswerSchema);
