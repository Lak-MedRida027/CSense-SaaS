import { Schema, Types } from 'mongoose';
import { MIN_QUESTION_OPTIONS } from '@csense/shared';

interface QuestionShape {
  options: string[];
}

/**
 * Class UML: Question, embedded in Assessment (composition, 1..*).
 * `correctAnswer` is an integer index into `options` (decision U10) and is never selected by default.
 */
export const questionSchema = new Schema(
  {
    questionId: { type: Schema.Types.ObjectId, default: () => new Types.ObjectId() },
    text: { type: String, required: true, trim: true },
    options: {
      type: [{ type: String, required: true, trim: true }],
      validate: {
        validator: (v: string[]) => Array.isArray(v) && v.length >= MIN_QUESTION_OPTIONS,
        message: `a question needs at least ${MIN_QUESTION_OPTIONS} options`,
      },
    },
    correctAnswer: {
      type: Number,
      required: true,
      select: false,
      validate: {
        validator(this: QuestionShape, v: number): boolean {
          return Number.isInteger(v) && v >= 0 && v < this.options.length;
        },
        message: 'correctAnswer must be an integer index into options',
      },
    },
  },
  { _id: false, strict: 'throw' },
);
