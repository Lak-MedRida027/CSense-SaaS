import { z } from 'zod';
import { ASSESSMENT_KINDS } from '../constants/assessment.js';
import { PROGRESS_STATUSES } from '../constants/enums.js';
import { ATTEMPT_END_REASONS, QUIZ_BLOCKED_REASONS } from '../constants/learning.js';

/**
 * Strict response schemas (ADR 0007). Server tests parse every employee-facing response with them,
 * so a stray `correctAnswer` or `explanation` fails the build. The client parses with them too.
 */
const id = z.string();
const iso = z.string();
const status = z.enum(PROGRESS_STATUSES);
const nullableScore = z.number().int().min(0).max(100).nullable();

export const moduleSummarySchema = z
  .object({
    id,
    position: z.number().int().min(1),
    title: z.string(),
    description: z.string(),
    format: z.enum(['video', 'interactive']),
    durationMinutes: z.number().int().min(0),
    status,
    lockedBy: z
      .object({ moduleId: id, position: z.number().int().min(1), title: z.string() })
      .strict()
      .nullable(),
    attempts: z.number().int().min(0),
    bestScore: nullableScore,
    passed: z.boolean(),
    completedAt: iso.nullable(),
  })
  .strict();

export const finalTestStatusSchema = z
  .object({
    status,
    title: z.string(),
    questionCount: z.number().int().min(0),
    passingScore: z.number().int().min(0).max(100),
    remainingModules: z.number().int().min(0),
    attempts: z.number().int().min(0),
    bestScore: nullableScore,
    passed: z.boolean(),
    completedAt: iso.nullable(),
  })
  .strict();

export const learningOverviewSchema = z
  .object({
    modules: z.array(moduleSummarySchema),
    totalModules: z.number().int().min(0),
    completedCount: z.number().int().min(0),
    nextModuleId: id.nullable(),
    finalTest: finalTestStatusSchema.nullable(),
  })
  .strict();

export const moduleProgressSchema = z
  .object({
    moduleId: id,
    status,
    startedAt: iso.nullable(),
    contentCompletedAt: iso.nullable(),
    exerciseAnswers: z.array(
      z.object({ exerciseId: id, selectedIndex: z.number().int(), correct: z.boolean() }).strict(),
    ),
  })
  .strict();

const blockedReason = z.enum(QUIZ_BLOCKED_REASONS).nullable();

export const quizOverviewSchema = z
  .object({
    quizId: id,
    moduleId: id,
    title: z.string(),
    questionCount: z.number().int().min(0),
    passingScore: z.number().int().min(0).max(100),
    attempts: z.number().int().min(0),
    nextAttemptNumber: z.number().int().min(1),
    bestScore: nullableScore,
    passed: z.boolean(),
    canStart: z.boolean(),
    blockedReason,
    /** Set while new sessions are blocked after repeated failures (ISO time), else null. */
    cooldownUntil: iso.nullable(),
  })
  .strict();

export const finalTestOverviewSchema = z
  .object({
    ...finalTestStatusSchema.shape,
    finalTestId: id,
    nextAttemptNumber: z.number().int().min(1),
    canStart: z.boolean(),
    blockedReason,
    cooldownUntil: iso.nullable(),
  })
  .strict();

export const moduleDetailSchema = z
  .object({
    module: moduleSummarySchema,
    content: z
      .object({
        body: z.string(),
        keyTakeaways: z.array(z.string()),
        video: z
          .object({
            url: z.string(),
            captionsUrl: z.string().nullable(),
            transcript: z.array(
              z
                .object({
                  id: z.number().int().min(0),
                  startSeconds: z.number().int().min(0),
                  text: z.string(),
                })
                .strict(),
            ),
          })
          .strict()
          .nullable(),
        exercises: z.array(
          z
            .object({
              exerciseId: id,
              prompt: z.string(),
              artifact: z.string().nullable(),
              options: z.array(z.string()),
            })
            .strict(),
        ),
      })
      .strict(),
    progress: moduleProgressSchema,
    quiz: quizOverviewSchema.nullable(),
  })
  .strict();

export const exerciseFeedbackSchema = z
  .object({
    exerciseId: id,
    selectedIndex: z.number().int(),
    correct: z.boolean(),
    correctIndex: z.number().int().min(0),
    explanation: z.string(),
    recorded: z.boolean(),
  })
  .strict();

/** Questions served to the employee: no key, no explanation. */
export const assessmentSessionSchema = z
  .object({
    sessionId: id,
    kind: z.enum(ASSESSMENT_KINDS),
    assessmentId: id,
    moduleId: id.nullable(),
    title: z.string(),
    passingScore: z.number().int().min(0).max(100),
    attemptNumber: z.number().int().min(1),
    startedAt: iso,
    expiresAt: iso,
    questions: z.array(
      z.object({ questionId: id, text: z.string(), options: z.array(z.string()) }).strict(),
    ),
  })
  .strict();

export const reviewItemSchema = z
  .object({
    questionId: id,
    text: z.string(),
    options: z.array(z.string()),
    selectedIndex: z.number().int().nullable(),
    correct: z.boolean(),
    explanation: z.string().optional(),
    correctIndex: z.number().int().min(0).optional(),
  })
  .strict();

export const attemptSummarySchema = z
  .object({
    attemptId: id,
    kind: z.enum(ASSESSMENT_KINDS),
    assessmentId: id,
    moduleId: id.nullable(),
    attemptNumber: z.number().int().min(1),
    endReason: z.enum(ATTEMPT_END_REASONS),
    score: z.number().int().min(0).max(100),
    passed: z.boolean(),
    correctCount: z.number().int().min(0),
    totalCount: z.number().int().min(1),
    passingScore: z.number().int().min(0).max(100),
    attemptedAt: iso,
  })
  .strict();

export const attemptDetailSchema = z
  .object({ ...attemptSummarySchema.shape, review: z.array(reviewItemSchema) })
  .strict();

export const attemptResultSchema = z
  .object({
    ...attemptDetailSchema.shape,
    progression: z
      .object({
        moduleCompleted: z.boolean(),
        nextModuleId: id.nullable(),
        finalTestUnlocked: z.boolean(),
      })
      .strict(),
    effects: z
      .object({
        xpEarned: z.number().int().min(0).optional(),
        badge: z.object({ id, name: z.string(), iconMotif: z.string() }).strict().optional(),
      })
      .strict(),
  })
  .strict();

export const attemptListSchema = z
  .object({ items: z.array(attemptSummarySchema), nextCursor: id.nullable() })
  .strict();
