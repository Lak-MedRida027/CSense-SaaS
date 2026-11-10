import { Schema, model, type InferSchemaType } from 'mongoose';
import { LEVELS, ROLES } from '@csense/shared';
import { baseSchemaOptions, intValidator } from './schemaOptions.js';

/**
 * Class UML: User (abstract in practice) with Employee and Administrator subclasses.
 * Mapped as one `users` collection with a Mongoose discriminator on `role` (decision U1).
 */
const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true },
    department: { type: String, trim: true, maxlength: 120 },
    isActive: { type: Boolean, default: true },
    // Required for every account except the bootstrap administrator (decision U20, Phase 2).
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    ...baseSchemaOptions,
    discriminatorKey: 'role',
    collection: 'users',
    toJSON: {
      ...baseSchemaOptions.toJSON,
      transform: (_doc: unknown, ret: Record<string, unknown>) => {
        delete ret._id;
        delete ret.passwordHash;
        return ret;
      },
    },
  },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ role: 1, isActive: 1 });
// Disengagement scan: active employees paged by _id (P4-L5, P4-L12).
userSchema.index({ role: 1, isActive: 1, _id: 1 });
userSchema.index({ department: 1 });
// At most one account without a creator: the bootstrap administrator (decision U20). Two concurrent
// bootstrap runs cannot both insert; the loser gets a duplicate-key error (P2-L3).
userSchema.index(
  { createdBy: 1 },
  { unique: true, partialFilterExpression: { createdBy: { $type: 'null' } } },
);

/**
 * Invariant (decision U20): only the bootstrap administrator may have `createdBy: null`.
 * Registered on the base schema BEFORE the discriminators are created, so both inherit it.
 * The bootstrap script opts in with `doc.$locals.bootstrap = true`.
 */
interface CreatedByGuard {
  isNew: boolean;
  createdBy?: unknown;
  $locals: { bootstrap?: boolean };
  invalidate: (path: string, message: string) => unknown;
}

userSchema.pre('validate', function (this: CreatedByGuard) {
  const bootstrap = this.$locals.bootstrap === true;
  if (this.isNew && this.createdBy == null && !bootstrap) {
    this.invalidate(
      'createdBy',
      'createdBy is required for every account except the bootstrap administrator',
    );
  }
});

export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = model('User', userSchema);

const employeeSchema = new Schema(
  {
    totalXP: { type: Number, default: 0, min: 0, validate: intValidator },
    level: { type: String, enum: LEVELS, default: LEVELS[0] },
    // Cache of the latest gate run being restricted and not restored (ADR 0015). The access gate
    // reads it on every request; reconcile repairs it from gateruns, the record of truth.
    gateRestriction: {
      type: new Schema(
        {
          restrictedAt: { type: Date, required: true },
          runId: { type: Schema.Types.ObjectId, ref: 'GateRun', required: true },
        },
        { _id: false, strict: 'throw' },
      ),
      default: null,
    },
  },
  { strict: 'throw' },
);

export const Employee = User.discriminator('Employee', employeeSchema, 'employee');

// Administrator adds no attributes in the Class UML.
export const Administrator = User.discriminator(
  'Administrator',
  new Schema({}, { strict: 'throw' }),
  'administrator',
);
