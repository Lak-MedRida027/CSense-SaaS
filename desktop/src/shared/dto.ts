/**
 * Type-only re-exports of the shared DTOs the bridge uses. Kept in one file so the preload bundle
 * (which must not load zod at runtime) only ever sees erased type imports.
 */
import type { z } from 'zod';
import type {
  assessmentSessionSchema,
  attemptResultSchema,
  exerciseFeedbackSchema,
  finalTestOverviewSchema,
  learningOverviewSchema,
  moduleDetailSchema,
  moduleProgressSchema,
  moduleSummarySchema,
  myBadgesSchema,
  onboardingStateSchema,
  quizOverviewSchema,
  xpSummarySchema,
} from '@csense/shared';

export type { ErrorCode, GateAttemptResultDTO, GateStatusDTO } from '@csense/shared';
export type AssessmentSessionDTO = z.infer<typeof assessmentSessionSchema>;
export type AttemptResultDTO = z.infer<typeof attemptResultSchema>;
export type LearningOverviewDTO = z.infer<typeof learningOverviewSchema>;
export type QuizOverviewDTO = z.infer<typeof quizOverviewSchema>;
export type ModuleSummaryDTO = z.infer<typeof moduleSummarySchema>;
export type ModuleDetailDTO = z.infer<typeof moduleDetailSchema>;
export type ModuleProgressDTO = z.infer<typeof moduleProgressSchema>;
export type ExerciseFeedbackDTO = z.infer<typeof exerciseFeedbackSchema>;
export type FinalTestOverviewDTO = z.infer<typeof finalTestOverviewSchema>;
export type XpSummaryDTO = z.infer<typeof xpSummarySchema>;
export type MyBadgesDTO = z.infer<typeof myBadgesSchema>;
export type OnboardingStateDTO = z.infer<typeof onboardingStateSchema>;
export type { BadgeProgressDTO } from '@csense/shared';
