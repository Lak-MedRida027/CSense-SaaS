/**
 * Type-only re-exports of the shared DTOs the bridge uses. Kept in one file so the preload bundle
 * (which must not load zod at runtime) only ever sees erased type imports.
 */
import type { z } from 'zod';
import type {
  assessmentSessionSchema,
  attemptResultSchema,
  learningOverviewSchema,
  quizOverviewSchema,
} from '@csense/shared';

export type { ErrorCode, GateAttemptResultDTO, GateStatusDTO } from '@csense/shared';
export type AssessmentSessionDTO = z.infer<typeof assessmentSessionSchema>;
export type AttemptResultDTO = z.infer<typeof attemptResultSchema>;
export type LearningOverviewDTO = z.infer<typeof learningOverviewSchema>;
export type QuizOverviewDTO = z.infer<typeof quizOverviewSchema>;
