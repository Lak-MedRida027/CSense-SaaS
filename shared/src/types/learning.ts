import type { z } from 'zod';
import type {
  assessmentSessionSchema,
  attemptDetailSchema,
  attemptListSchema,
  attemptResultSchema,
  attemptSummarySchema,
  exerciseFeedbackSchema,
  finalTestOverviewSchema,
  finalTestStatusSchema,
  learningOverviewSchema,
  moduleDetailSchema,
  moduleProgressSchema,
  moduleSummarySchema,
  quizOverviewSchema,
  reviewItemSchema,
} from '../schemas/learningResponses.js';

/** Learning DTOs are inferred from the strict response schemas, so the two cannot drift. */
export type ModuleSummaryDTO = z.infer<typeof moduleSummarySchema>;
export type FinalTestStatusDTO = z.infer<typeof finalTestStatusSchema>;
export type LearningOverviewDTO = z.infer<typeof learningOverviewSchema>;
export type ModuleProgressDTO = z.infer<typeof moduleProgressSchema>;
export type ModuleDetailDTO = z.infer<typeof moduleDetailSchema>;
export type QuizOverviewDTO = z.infer<typeof quizOverviewSchema>;
export type FinalTestOverviewDTO = z.infer<typeof finalTestOverviewSchema>;
export type ExerciseFeedbackDTO = z.infer<typeof exerciseFeedbackSchema>;
export type AssessmentSessionDTO = z.infer<typeof assessmentSessionSchema>;
export type ReviewItemDTO = z.infer<typeof reviewItemSchema>;
export type AttemptSummaryDTO = z.infer<typeof attemptSummarySchema>;
export type AttemptDetailDTO = z.infer<typeof attemptDetailSchema>;
export type AttemptResultDTO = z.infer<typeof attemptResultSchema>;
export type AttemptListDTO = z.infer<typeof attemptListSchema>;
