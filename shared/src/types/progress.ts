import type { ProgressStatus } from '../constants/enums.js';

/** Per-employee, per-module progress (Class UML `UserProgress`). */
export interface UserProgressDTO {
  id: string;
  userId: string;
  moduleId: string;
  status: ProgressStatus;
  quizScore?: number;
  quizPassed: boolean;
  attempts: number;
  completedAt?: string;
}
