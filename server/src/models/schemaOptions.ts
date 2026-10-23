/**
 * Conventions shared by every CSense schema (docs/architecture/data-model.md):
 * - `strict: 'throw'` rejects unknown fields instead of silently dropping them.
 * - `timestamps` is NOT in the Class UML; added for auditability (FR12/FR13, ISO 27001).
 * - JSON output drops `__v` and exposes `id` as a string.
 */
export const intValidator = {
  validator: (v: unknown): boolean => v === undefined || v === null || Number.isInteger(v),
  message: '{PATH} must be an integer',
};

export const baseSchemaOptions = {
  strict: 'throw',
  timestamps: true,
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      delete ret._id;
      return ret;
    },
  },
} as const;
