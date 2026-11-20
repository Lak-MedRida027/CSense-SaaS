import type { EmployeePageProps } from '../employeeNav';

export interface FinalAssessmentInfo {
  status: 'locked' | 'unlocked' | 'in_progress' | 'completed';
  title: string;
  questionCount: number;
  passMarkPercent: number;
  attemptNumber: number;
  /** Locked: why. */
  lockedReason?: string | undefined;
  /** Completed: the score and date shown instead of a retake. */
  scorePercent?: number | undefined;
  completedOn?: string | undefined;
  /** Available but cannot start now (for example a cooldown). */
  startBlocked?: { reason: string } | undefined;
}

export interface FinalAssessmentScreenProps extends EmployeePageProps {
  /** With `state: 'empty'`, no final assessment is configured (404). */
  final?: FinalAssessmentInfo | undefined;
  starting?: boolean | undefined;
  onStart: () => void;
  onBackToDashboard: () => void;
}
