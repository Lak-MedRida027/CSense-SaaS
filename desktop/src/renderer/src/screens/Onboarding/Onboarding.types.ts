import type { Level } from '@csense/shared';
import type { DisplayPreferences } from '../../design/theme/ThemeContext';

export interface OnboardingScreenProps {
  employeeName: string;
  /** Number of modules in the programme, from the learning overview; unknown while it loads. */
  moduleCount?: number | undefined;
  /** Default pass mark shown in the explainer as "usually" (configurable per module; default 70). */
  passMarkPercent: number;
  /** Ladder shown on the progress step. */
  levels: readonly Level[];
  /** Initial display preferences (from storage). */
  initialPreferences?: Partial<DisplayPreferences> | undefined;
  /** Seam: finish onboarding with the chosen preferences, then open Module 1. */
  onComplete: (preferences: DisplayPreferences) => void;
  /** Seam: skip the intro (preferences stay as they are). */
  onSkip: () => void;
}
