import { Schema, Types } from 'mongoose';
import { MAX_OPTIONS, MIN_QUESTION_OPTIONS } from '@csense/shared';

interface ExerciseShape {
  options: string[];
}

/**
 * Interactive exercise embedded in a Module (Phase 3). `correctAnswer` and `explanation` are
 * `select: false`: they are returned only by the answer endpoint, after the employee has answered.
 */
export const exerciseSchema = new Schema(
  {
    exerciseId: { type: Schema.Types.ObjectId, default: () => new Types.ObjectId() },
    prompt: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 },
    artifact: { type: String, trim: true, maxlength: 2000 },
    options: {
      type: [{ type: String, required: true, trim: true, minlength: 1, maxlength: 300 }],
      validate: {
        validator: (v: string[]) =>
          Array.isArray(v) && v.length >= MIN_QUESTION_OPTIONS && v.length <= MAX_OPTIONS,
        message: `an exercise needs between ${String(MIN_QUESTION_OPTIONS)} and ${String(MAX_OPTIONS)} options`,
      },
    },
    correctAnswer: {
      type: Number,
      required: true,
      select: false,
      validate: {
        validator(this: ExerciseShape, v: number): boolean {
          return Number.isInteger(v) && v >= 0 && v < this.options.length;
        },
        message: 'correctAnswer must be an integer index into options',
      },
    },
    explanation: {
      type: String,
      required: true,
      select: false,
      trim: true,
      minlength: 1,
      maxlength: 1000,
    },
  },
  { _id: false, strict: 'throw' },
);
