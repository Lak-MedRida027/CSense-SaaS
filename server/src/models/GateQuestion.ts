import { Schema, model, type InferSchemaType } from 'mongoose';
import { GATE_OPTION_MAX, GATE_OPTION_MIN } from '@csense/shared';
import { baseSchemaOptions, intValidator } from './schemaOptions.js';

/**
 * Security-gate question (Phase 5, ADR 0015). A pool separate from the quiz pools, so the gate
 * never leaks module quiz keys. The key and the explanation are `select: false`: only the gate
 * service reads them, explicitly.
 */
const gateQuestionSchema = new Schema(
  {
    prompt: { type: String, required: true, trim: true, minlength: 1, maxlength: 1000 },
    options: {
      type: [{ type: String, trim: true, minlength: 1, maxlength: 300 }],
      validate: {
        validator: (v: unknown[]) => v.length >= GATE_OPTION_MIN && v.length <= GATE_OPTION_MAX,
        message: `options must hold ${String(GATE_OPTION_MIN)} to ${String(GATE_OPTION_MAX)} items`,
      },
    },
    correctAnswer: {
      type: Number,
      required: true,
      min: 0,
      validate: intValidator,
      select: false,
    },
    explanation: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 1000,
      select: false,
    },
    topic: { type: String, trim: true, maxlength: 60 },
    isActive: { type: Boolean, default: true },
  },
  { ...baseSchemaOptions, collection: 'gatequestions' },
);

gateQuestionSchema.index({ isActive: 1 });

// The key must point inside the options (checked on create and save).
gateQuestionSchema.pre(
  'validate',
  function (this: {
    correctAnswer?: number;
    options: unknown[];
    invalidate: (path: string, message: string) => unknown;
  }) {
    const key = this.correctAnswer;
    if (typeof key === 'number' && key >= this.options.length) {
      this.invalidate('correctAnswer', 'correctAnswer must be an index into options');
    }
  },
);

export type GateQuestionDoc = InferSchemaType<typeof gateQuestionSchema>;
export const GateQuestion = model('GateQuestion', gateQuestionSchema);
