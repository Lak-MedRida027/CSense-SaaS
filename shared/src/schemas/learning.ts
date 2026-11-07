import { z } from 'zod';
import { ASSESSMENT_KINDS } from '../constants/assessment.js';
import { MAX_ANSWERS_PER_SUBMISSION, MAX_OPTIONS } from '../constants/learning.js';
import { objectIdSchema } from './common.js';

/** Ids are lower-cased so a differently-cased copy of a served id can never look "unserved". */
const idSchema = objectIdSchema.transform((v) => v.toLowerCase());

/** Index into an option list. Per-question bounds are enforced against the served snapshot. */
const optionIndexSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_OPTIONS - 1);

export const moduleParamsSchema = z.object({ moduleId: idSchema }).strict();
export const exerciseParamsSchema = z.object({ moduleId: idSchema, exerciseId: idSchema }).strict();
export const moduleSessionParamsSchema = z
  .object({ moduleId: idSchema, sessionId: idSchema })
  .strict();
export const sessionParamsSchema = z.object({ sessionId: idSchema }).strict();
export const attemptParamsSchema = z.object({ attemptId: idSchema }).strict();

export const exerciseAnswerRequestSchema = z.object({ selectedIndex: optionIndexSchema }).strict();

/**
 * There is deliberately no score, passed or correct field: the strict schema rejects them, and the
 * server grades from its own snapshot (ADR 0007).
 */
export const submitAttemptRequestSchema = z
  .object({
    sessionId: idSchema,
    answers: z
      .array(
        z.object({ questionId: idSchema, selectedIndex: optionIndexSchema.nullable() }).strict(),
      )
      .max(MAX_ANSWERS_PER_SUBMISSION)
      .refine((answers) => new Set(answers.map((a) => a.questionId)).size === answers.length, {
        message: 'duplicate questionId',
      }),
  })
  .strict();

export const listAttemptsQuerySchema = z
  .object({
    kind: z.enum(ASSESSMENT_KINDS).optional(),
    moduleId: idSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    before: idSchema.optional(),
  })
  .strict();

export type SubmitAttemptRequest = z.infer<typeof submitAttemptRequestSchema>;
export type ExerciseAnswerRequest = z.infer<typeof exerciseAnswerRequestSchema>;
export type ListAttemptsQuery = z.infer<typeof listAttemptsQuerySchema>;
