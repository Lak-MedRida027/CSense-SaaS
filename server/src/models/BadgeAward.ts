import { Schema, model, type InferSchemaType } from 'mongoose';
import { BADGE_AWARD_SOURCES } from '@csense/shared';
import { appendOnly } from './plugins/appendOnly.js';
import { baseSchemaOptions } from './schemaOptions.js';

export class BadgeAwardImmutableError extends Error {
  readonly code = 'BADGE_AWARD_IMMUTABLE';
  constructor(operation: string) {
    super(`BadgeAward is append-only: ${operation} is not permitted`);
    this.name = 'BadgeAwardImmutableError';
  }
}

/** Class UML: Employee --earns--> Badge (0..*). One row per (employee, badge); awards are permanent. */
const badgeAwardSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    badgeId: { type: Schema.Types.ObjectId, ref: 'Badge', required: true },
    moduleId: { type: Schema.Types.ObjectId, ref: 'Module', required: true },
    attemptId: { type: Schema.Types.ObjectId, ref: 'QuizAttempt', default: null },
    source: { type: String, enum: BADGE_AWARD_SOURCES, required: true },
    awardedAt: { type: Date, required: true },
  },
  {
    ...baseSchemaOptions,
    collection: 'badgeawards',
    timestamps: { createdAt: true, updatedAt: false },
  },
);

badgeAwardSchema.index({ userId: 1, badgeId: 1 }, { unique: true });
badgeAwardSchema.index({ badgeId: 1 });
badgeAwardSchema.index({ userId: 1, awardedAt: -1 });

appendOnly(badgeAwardSchema, (operation) => new BadgeAwardImmutableError(operation));

export type BadgeAwardDoc = InferSchemaType<typeof badgeAwardSchema>;
export const BadgeAward = model('BadgeAward', badgeAwardSchema);
