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
  state?: 'ready' | 'loading' | 'error' | 'empty' | undefined;
}

/** Exercise props minus the callbacks, which are lifted to the screen props. */
export type ModulePlayerExercise = Omit<
  InteractiveExerciseProps,
  'onAnswer' | 'onNext' | 'className'
>;

export interface ModulePlayerScreenProps {
  module: ModulePlayerModule;
  totalModules: number;
  /** Sidebar list; locked items carry their unlock rule. */
  modules: readonly ModuleListItem[];
  finalAssessment: { status: ProgressStatus; lockedReason?: string | undefined };
  stage: ModuleStage;
  /** Required when `module.format === 'video'`. */
  video?: ModulePlayerVideo | undefined;
  /** Required when `module.format === 'interactive'` (and for the practice stage of video modules). */
  exercise?: ModulePlayerExercise | undefined;
  keyTakeaways?: readonly ReactNode[] | undefined;
  /** Whether the quiz may start (e.g. video watched); decided outside the UI (D7). */
  canStartQuiz: boolean;
  /** Why the quiz is not available yet, e.g. "Watch the video to continue". */
  quizLockedReason?: string | undefined;
  onSelectModule: (moduleId: string) => void;
  onStartQuiz: () => void;
  onContinueToPractice?: (() => void) | undefined;
  onVideoProgress?: ((currentSeconds: number, durationSeconds: number) => void) | undefined;
  onVideoEnded?: (() => void) | undefined;
  onExerciseAnswer?: ((choiceId: string) => void) | undefined;
  onExerciseNext?: (() => void) | undefined;
  onBackToDashboard: () => void;
}
