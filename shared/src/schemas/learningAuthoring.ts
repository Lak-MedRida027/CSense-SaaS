import { z } from 'zod';
import { MODULE_FORMATS } from '../constants/enums.js';
import {
  MAX_EXERCISES,
  MAX_KEY_TAKEAWAYS,
  MAX_OPTIONS,
  MAX_TRANSCRIPT_CUES,
  MIN_POOL_FACTOR,
} from '../constants/learning.js';
import { DEFAULT_PASSING_SCORE, MIN_QUESTION_OPTIONS } from '../constants/assessment.js';

/**
 * Authoring schemas: what the seed (Phase 3) and the admin content API (Phase 7) accept. They are
 * stricter than the Mongoose models (https only, mandatory explanations).
 */
const httpsUrl = z
  .string()
  .max(2048)
  .regex(/^https:\/\/[A-Za-z0-9.-]+(:\d+)?([/?#]\S*)?$/, 'must be an https URL');

const options = z
  .array(z.string().trim().min(1).max(300))
  .min(MIN_QUESTION_OPTIONS)
  .max(MAX_OPTIONS);

const keyInRange = (v: { options: string[]; correctAnswer: number }): boolean =>
  v.correctAnswer < v.options.length;
const keyMessage = {
  message: 'correctAnswer must be an index into options',
  path: ['correctAnswer'],
};

export const exerciseAuthoringSchema = z
  .object({
    prompt: z.string().trim().min(1).max(2000),
    artifact: z.string().trim().min(1).max(2000).optional(),
    options,
    correctAnswer: z.number().int().min(0),
    explanation: z.string().trim().min(1).max(1000),
  })
  .strict()
  .refine(keyInRange, keyMessage);

export const questionAuthoringSchema = z
  .object({
    text: z.string().trim().min(1).max(1000),
    options,
    correctAnswer: z.number().int().min(0),
    explanation: z.string().trim().min(1).max(1000),
  })
  .strict()
  .refine(keyInRange, keyMessage);

export const moduleAuthoringSchema = z
  .object({
    order: z.number().int().min(1),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2000),
    format: z.enum(MODULE_FORMATS),
    /** Estimated minutes. */
    duration: z.number().int().min(0).max(600),
    isPublished: z.boolean().default(false),
    content: z.string().max(20_000).default(''),
    videoUrl: httpsUrl.optional(),
    captionsUrl: httpsUrl.optional(),
    transcript: z
      .array(
        z
          .object({
            startSeconds: z.number().int().min(0),
            text: z.string().trim().min(1).max(2000),
          })
          .strict(),
      )
      .max(MAX_TRANSCRIPT_CUES)
      .default([]),
    keyTakeaways: z.array(z.string().trim().min(1).max(300)).max(MAX_KEY_TAKEAWAYS).default([]),
    exercises: z.array(exerciseAuthoringSchema).max(MAX_EXERCISES).default([]),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (!m.isPublished) return;
    if (m.format === 'video' && m.videoUrl === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['videoUrl'],
        message: 'a published video module needs a videoUrl',
      });
    }
    if (m.format === 'interactive' && m.exercises.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['exercises'],
        message: 'a published interactive module needs at least one exercise',
      });
    }
  });

export const assessmentAuthoringSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    passingScore: z.number().int().min(0).max(100).default(DEFAULT_PASSING_SCORE),
    /** How many questions of the pool one session serves. */
    questionsPerSession: z.number().int().min(1).max(100),
    questions: z.array(questionAuthoringSchema).min(1).max(200),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (a.questions.length < a.questionsPerSession * MIN_POOL_FACTOR) {
      ctx.addIssue({
        code: 'custom',
        path: ['questions'],
        message: `the pool needs at least ${String(MIN_POOL_FACTOR)} times questionsPerSession questions`,
      });
    }
  });

export type ModuleAuthoring = z.infer<typeof moduleAuthoringSchema>;
export type AssessmentAuthoring = z.infer<typeof assessmentAuthoringSchema>;
