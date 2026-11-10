import { Schema, Types } from 'mongoose';
import { MAX_OPTIONS, MIN_QUESTION_OPTIONS } from '@csense/shared';

interface QuestionShape {
  options: string[];
}

/**
 * Class UML: Question, embedded in Assessment (composition, 1..*).
 * `correctAnswer` is an integer index into `options` (decision U10). Both it and `explanation` are
 * never selected by default; the learning engine opts in with `+questions.correctAnswer` etc.
 */
export const questionSchema = new Schema(
  {
    questionId: { type: Schema.Types.ObjectId, default: () => new Types.ObjectId() },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    options: {
      type: [{ type: String, required: true, trim: true, maxlength: 300 }],
      validate: {
        validator: (v: string[]) =>
          Array.isArray(v) && v.length >= MIN_QUESTION_OPTIONS && v.length <= MAX_OPTIONS,
        message: `a question needs at least ${String(MIN_QUESTION_OPTIONS)} options and at most ${String(MAX_OPTIONS)}`,
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
    // Teaches the concept without naming the correct option. Shown in reviews per the reveal policy.
    explanation: { type: String, trim: true, maxlength: 1000, default: '', select: false },
  },
  { _id: false, strict: 'throw' },
);
