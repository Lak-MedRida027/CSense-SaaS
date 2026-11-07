import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions, intValidator } from './schemaOptions.js';

/**
 * Per-(employee, assessment) ledger for the learning engine (not in the Class UML).
 * - `seq` hands out attempt numbers with an atomic `$inc` when a session starts.
 * - `firstPassAt` is set by a conditional write, so "first pass" (and the exactly-once completion
 *   hooks) is decided by the database, not by a check-then-insert.
 * - `attempts` and `bestScore` replace an unbounded aggregation over the attempt history.
 */
const attemptCounterSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    assessmentId: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true },
    seq: { type: Number, default: 0, min: 0, validate: intValidator },
    attempts: { type: Number, default: 0, min: 0, validate: intValidator },
    bestScore: { type: Number, default: null, min: 0, max: 100, validate: intValidator },
    firstPassAt: { type: Date, default: null },
    // Failed attempts in a row (abandoned and expired count). A pass resets it; reaching the
    // configured limit starts a cooldown and resets it too.
    consecutiveFails: { type: Number, default: 0, min: 0, validate: intValidator },
    cooldownUntil: { type: Date, default: null },
  },
  { ...baseSchemaOptions, collection: 'attemptcounters' },
);

attemptCounterSchema.index({ userId: 1, assessmentId: 1 }, { unique: true });

export type AttemptCounterDoc = InferSchemaType<typeof attemptCounterSchema>;
export const AttemptCounter = model('AttemptCounter', attemptCounterSchema);
