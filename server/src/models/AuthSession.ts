import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions, intValidator } from './schemaOptions.js';

export const AUTH_SESSION_REVOKE_REASONS = [
  'logout',
  'reuse_detected',
  'user_inactive',
  'admin_revoked',
] as const;
export type AuthSessionRevokeReason = (typeof AUTH_SESSION_REVOKE_REASONS)[number];

/** Retained for investigations after expiry (30 days). */
const KEEP_AFTER_EXPIRY_SECONDS = 30 * 24 * 60 * 60;

/**
 * One document per refresh-token family (ADR 0004). Refresh tokens are stored only as
 * HMAC-SHA256 digests; the digests are never selected by default and never serialised.
 */
const authSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    currentTokenHash: { type: String, required: true, select: false },
    previousTokenHashes: { type: [String], default: [], select: false },
    expiresAt: { type: Date, required: true },
    rotatedAt: { type: Date, default: null },
    rotationCount: { type: Number, default: 0, min: 0, validate: intValidator },
    revokedAt: { type: Date, default: null },
    revokedReason: {
      type: String,
      enum: [...AUTH_SESSION_REVOKE_REASONS, null],
      default: null,
    },
    ip: { type: String, maxlength: 64 },
    userAgent: { type: String, maxlength: 256 },
  },
  {
    ...baseSchemaOptions,
    collection: 'authsessions',
    toJSON: {
      ...baseSchemaOptions.toJSON,
      transform: (_doc: unknown, ret: Record<string, unknown>) => {
        delete ret._id;
        delete ret.currentTokenHash;
        delete ret.previousTokenHashes;
        return ret;
      },
    },
  },
);

authSessionSchema.index({ userId: 1, revokedAt: 1 });
authSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: KEEP_AFTER_EXPIRY_SECONDS });

export type AuthSessionDoc = InferSchemaType<typeof authSessionSchema>;
export const AuthSession = model('AuthSession', authSessionSchema);
