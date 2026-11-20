import type { ModuleFormat, ProgressStatus } from '@csense/shared';
import type { ReactNode } from 'react';
import type { InteractiveExerciseProps } from '../../components/InteractiveExercise';
import type { ModuleListItem } from '../../components/ModuleList';
import type { TranscriptCue } from '../../components/TranscriptPanel';

export type ModuleStage = 'lesson' | 'practice' | 'quiz';

export interface ModulePlayerModule {
  id: string;
  order: number;
  title: string;
  format: ModuleFormat;
  durationMinutes: number;
}

export interface ModulePlayerVideo {
  src?: string | undefined;
  captionsSrc?: string | undefined;
  poster?: string | undefined;
  transcript: readonly TranscriptCue[];
  /** `error`/`empty` mean the video is unavailable: the transcript opens and becomes the lesson. */
  state?: 'ready' | 'loading' | 'error' | 'empty' | undefined;
}

/** Exercise props minus the callbacks, which are lifted to the screen props. */
export type ModulePlayerExercise = Omit<
  InteractiveExerciseProps,
  'onAnswer' | 'onNext' | 'className'
>;

/** The primary action of the lesson stage ("Continue to practice" / "Continue to quiz"). */
export interface LessonAction {
  label: string;
  enabled: boolean;
  /** Why it is disabled, e.g. "Watch the video or read the transcript to continue". */
  reason?: string | undefined;
  busy?: boolean | undefined;
}

export type ModulePlayerState = 'ready' | 'loading' | 'error' | 'locked' | 'not_found';

export interface ModulePlayerScreenProps {
  /** Required when `state` is `ready`; may be known earlier from the overview. */
  module?: ModulePlayerModule | undefined;
  totalModules: number;
  /** Sidebar list; locked items carry their unlock rule. */
  modules: readonly ModuleListItem[];
  finalAssessment: {
    status: ProgressStatus;
    lockedReason?: string | undefined;
    onSelect?: (() => void) | undefined;
  };
  /** Defaults to `ready`. */
  state?: ModulePlayerState | undefined;
  /** Shown for `locked`, e.g. "Pass the Module 2 quiz to unlock". */
  lockedReason?: string | undefined;
  /** Shown above the content for recoverable problems (for example a failed save). */
  notice?: { tone: 'caution' | 'critical' | 'info'; text: ReactNode } | undefined;
  onRetry?: (() => void) | undefined;
  stage: ModuleStage;
  /** Plain-text lesson body (rendered as paragraphs, never as HTML). */
  lessonBody?: string | undefined;
  /** Video modules: the player. Interactive modules have none. */
  video?: ModulePlayerVideo | undefined;
  /** The practice stage: one scenario at a time. */
  exercise?: ModulePlayerExercise | undefined;
  keyTakeaways?: readonly ReactNode[] | undefined;
  lessonAction?: LessonAction | undefined;
  /** Completed modules: shown on the quiz stage instead of starting a new session. */
  quizSummary?:
    | {
        passed: boolean;
        bestScore: number | null;
        attempts: number;
        /** Not passed and a new session cannot start now (for example a cooldown). */
        blockedReason?: string | undefined;
      }
    | undefined;
  /** Quiz stage, not yet passed: open the quiz intro. */
  onStartQuiz?: (() => void) | undefined;
  onSelectModule: (moduleId: string) => void;
  onLessonAction?: (() => void) | undefined;
  onVideoProgress?: ((currentSeconds: number, durationSeconds: number) => void) | undefined;
  onVideoEnded?: (() => void) | undefined;
  onVideoError?: (() => void) | undefined;
  onTranscriptReachedEnd?: (() => void) | undefined;
  onExerciseAnswer?: ((choiceId: string) => void) | undefined;
  onExerciseNext?: (() => void) | undefined;
  /** Completed modules: leave the quiz summary for the lesson or practice again. */
  onSelectStage?: ((stage: ModuleStage) => void) | undefined;
  onBackToDashboard: () => void;
}
