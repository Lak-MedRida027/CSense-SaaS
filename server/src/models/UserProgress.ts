import { Schema, model, type InferSchemaType } from 'mongoose';
import { MAX_EXERCISES } from '@csense/shared';
import { baseSchemaOptions, intValidator } from './schemaOptions.js';

/** The first answer an employee gave to an interactive exercise. */
const exerciseAnswerSchema = new Schema(
  {
    exerciseId: { type: Schema.Types.ObjectId, required: true },
    selectedIndex: { type: Number, required: true, min: 0, validate: intValidator },
    correct: { type: Boolean, required: true },
    answeredAt: { type: Date, required: true },
  },
  { _id: false, strict: 'throw' },
);

/**
 * Class UML: UserProgress, one row per (employee, module).
 * Facts only (ADR 0006): `status` is stored as `in_progress` or `completed`. The employee-visible
 * `locked` / `unlocked` / `in_progress` state is derived by `deriveModuleStates`, never read from here.
 */
const userProgressSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    moduleId: { type: Schema.Types.ObjectId, ref: 'Module', required: true },
    status: { type: String, enum: ['in_progress', 'completed'], default: 'in_progress' },
    // Best score across attempts.
    quizScore: { type: Number, min: 0, max: 100, validate: intValidator },
    quizPassed: { type: Boolean, default: false },
    // Submitted + abandoned + expired attempts.
    attempts: { type: Number, default: 0, min: 0, validate: intValidator },
    completedAt: { type: Date },
    startedAt: { type: Date, default: null },
    contentCompletedAt: { type: Date, default: null },
    exerciseAnswers: {
      type: [exerciseAnswerSchema],
      validate: {
        validator: (v: unknown[]) => Array.isArray(v) && v.length <= MAX_EXERCISES,
        message: `at most ${String(MAX_EXERCISES)} exercise answers`,
      },
    },
    lastAttemptAt: { type: Date, default: null },
  },
  { ...baseSchemaOptions, collection: 'userprogresses' },
);

// Implied by Employee (1) -- UserProgress (0..*) -- Module (1); not drawn as a constraint.
userProgressSchema.index({ userId: 1, moduleId: 1 }, { unique: true });
userProgressSchema.index({ moduleId: 1, status: 1 });

export type UserProgressDoc = InferSchemaType<typeof userProgressSchema>;
export const UserProgress = model('UserProgress', userProgressSchema);
