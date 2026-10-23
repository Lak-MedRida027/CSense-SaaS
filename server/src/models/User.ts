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
userSchema.index({ department: 1 });

export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = model('User', userSchema);

const employeeSchema = new Schema(
  {
    totalXP: { type: Number, default: 0, min: 0, validate: intValidator },
    level: { type: String, enum: LEVELS, default: LEVELS[0] },
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
