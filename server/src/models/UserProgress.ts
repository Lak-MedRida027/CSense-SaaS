import { Schema, model, type InferSchemaType } from 'mongoose';
import { PROGRESS_STATUSES } from '@csense/shared';
import { baseSchemaOptions, intValidator } from './schemaOptions.js';

/** Class UML: UserProgress, one row per (employee, module). */
const userProgressSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    moduleId: { type: Schema.Types.ObjectId, ref: 'Module', required: true },
    status: { type: String, enum: PROGRESS_STATUSES, default: 'locked' },
    quizScore: { type: Number, min: 0, max: 100, validate: intValidator },
    quizPassed: { type: Boolean, default: false },
    attempts: { type: Number, default: 0, min: 0, validate: intValidator },
    completedAt: { type: Date },
  },
  { ...baseSchemaOptions, collection: 'userprogresses' },
);

// Implied by Employee (1) -- UserProgress (0..*) -- Module (1); not drawn as a constraint.
userProgressSchema.index({ userId: 1, moduleId: 1 }, { unique: true });
userProgressSchema.index({ moduleId: 1, status: 1 });

export type UserProgressDoc = InferSchemaType<typeof userProgressSchema>;
export const UserProgress = model('UserProgress', userProgressSchema);
