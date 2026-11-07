import type { AssessmentKind, AttemptEndReason } from '@csense/shared';

/**
 * The seam between the learning engine and gamification / risk (ADR 0008). Phase 4 replaces
 * `noopLearningHooks`; grading code does not change.
 */
export interface AttemptEffects {
  xpEarned?: number;
  badge?: { id: string; name: string; iconMotif: string };
}

export interface AttemptRecordedEvent {
  userId: string;
  attemptId: string;
  kind: AssessmentKind;
  assessmentId: string;
  moduleId: string | null;
  attemptNumber: number;
  endReason: AttemptEndReason;
  score: number;
  passed: boolean;
  correctCount: number;
  totalCount: number;
  at: Date;
}

export interface ModuleCompletedEvent {
  userId: string;
  moduleId: string;
  attemptId: string;
  attemptNumber: number;
  score: number;
  at: Date;
}

export interface FinalTestPassedEvent {
  userId: string;
  assessmentId: string;
  attemptId: string;
  attemptNumber: number;
  score: number;
  at: Date;
}

export interface LearningHooks {
  /** Once per QuizAttempt (submitted, abandoned or expired). */
  onAttemptRecorded(event: AttemptRecordedEvent): Promise<AttemptEffects | undefined>;
  /** Exactly once per employee and module, on the first pass. */
  onModuleCompleted(event: ModuleCompletedEvent): Promise<AttemptEffects | undefined>;
  /** Exactly once per employee, on the first pass of the final test. */
  onFinalTestPassed(event: FinalTestPassedEvent): Promise<AttemptEffects | undefined>;
}

export const noopLearningHooks: LearningHooks = {
  onAttemptRecorded: () => Promise.resolve(undefined),
  onModuleCompleted: () => Promise.resolve(undefined),
  onFinalTestPassed: () => Promise.resolve(undefined),
};
