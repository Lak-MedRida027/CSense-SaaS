import type { ReactNode } from 'react';
import type { AchievementBadgeData } from '../../components/AchievementBadge';
import type { LockdownState } from '../../components/LockdownBanner';

/**
 * - `intro`: explains secure mode; lockdown not started yet.
 * - `answering`: questions, inside lockdown.
 * - `confirm-submit`: pre-submit review of answered/unanswered, inside lockdown.
 * - `result`: score (lockdown has exited).
 * - `review`: per-question review with correct answers and explanations.
 */
export type QuizPhase = 'intro' | 'answering' | 'confirm-submit' | 'result' | 'review';

export interface QuizQuestionData {
  id: string;
  stem: ReactNode;
  options: readonly { id: string; text: ReactNode }[];
  /** Only provided for the review phase (never sent to the client while answering). */
  correctOptionId?: string | undefined;
  explanation?: ReactNode | undefined;
}

export interface QuizResultData {
  scorePercent: number;
  /** Decided by the engine against the module's configurable threshold. */
  passed: boolean;
  correctCount: number;
  totalCount: number;
  xpEarned?: number | undefined;
  badge?: AchievementBadgeData | undefined;
}

export interface QuizScreenProps {
  kind: 'module' | 'final';
  /** e.g. "Module 3 quiz: Phishing" or "Final assessment". */
  title: string;
  phase: QuizPhase;
  lockdownState: LockdownState;
  /** Focus-loss / restart notice shown in the lockdown banner. */
  lockdownWarning?: string | undefined;
  questions: readonly QuizQuestionData[];
  /** questionId -> optionId (null/missing = unanswered). Controlled by the engineers' state. */
  answers: Readonly<Record<string, string | null | undefined>>;
  /** Zero-based. */
  currentIndex: number;
  /** Configurable per module; default 70 (DEFAULT_PASSING_SCORE). */
  passMarkPercent: number;
  /** e.g. 2 for a retry; shown on the intro. */
  attemptNumber?: number | undefined;
  result?: QuizResultData | undefined;
  submitting?: boolean | undefined;
  continueLabel?: string | undefined;

  /** Seam: ask the main process to enter lockdown (Phase 5). */
  onRequestStartLockdown: () => void;
  onAnswer: (questionId: string, optionId: string) => void;
  onNavigate: (index: number) => void;
  /** Move from the last question to the pre-submit review. */
  onRequestSubmitReview: () => void;
  onBackToQuestions: () => void;
  /** Seam: submit answers for grading. */
  onSubmit: () => void;
  /** Seam: user confirmed leaving mid-quiz (counts as an attempt, D5). */
  onConfirmExit: () => void;
  /** Hidden when not provided (Phase 5 shows the result only; review arrives in Phase 6). */
  onReviewAnswers?: (() => void) | undefined;
  onBackToResult: () => void;
  onRetry: () => void;
  onContinue: () => void;
  /** Intro "back" action. */
  onBackToModule?: (() => void) | undefined;
}
