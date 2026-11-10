import type { ProgressStatus } from '@csense/shared';

export interface TrainingHomeModule {
  id: string;
  order: number;
  title: string;
  status: ProgressStatus;
  /** Shown for locked modules, e.g. "Pass the Module 2 quiz to unlock". */
  lockedReason?: string | undefined;
  bestScore?: number | null | undefined;
  /** True once content is complete and the quiz can be started (from the quiz overview). */
  quizAvailable?: boolean | undefined;
  /** Why the quiz cannot start (cooldown, content incomplete...). */
  quizNote?: string | undefined;
}

export interface TrainingHomeProps {
  userName: string;
  role: 'employee' | 'administrator';
  level?: string | undefined;
  state: 'loading' | 'ready' | 'error';
  modules: readonly TrainingHomeModule[];
  finalTest?:
    | {
        status: ProgressStatus;
        title: string;
        available: boolean;
        note?: string | undefined;
      }
    | undefined;
  /** Shown above the list (e.g. "Released offline", reminder banners). */
  notice?: { tone: 'info' | 'caution'; text: string } | undefined;
  /** Seam: start the secure quiz for a module. */
  onStartQuiz: (moduleId: string) => void;
  onStartFinal: () => void;
  onRetry: () => void;
  onSignOut: () => void;
  appVersion?: string | undefined;
}
