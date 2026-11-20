import type { Level, ProgressStatus } from '@csense/shared';
import type { AchievementBadgeData } from '../../components/AchievementBadge';
import type { ModuleCardData } from '../../components/ModuleCard';

export interface EmployeeDashboardScreenProps {
  employee: { name: string; level: Level; totalXP: number };
  /** Level thresholds come from /shared (Phase 4); passed in for display only. */
  xp: {
    currentLevelFloorXP: number;
    nextLevelXP: number | undefined;
    nextLevel: Level | undefined;
    /** Optional XP floor per level for the ladder. */
    thresholds?: Partial<Record<Level, number>> | undefined;
  };
  modules: readonly ModuleCardData[];
  /** Unlock rule text per locked module id. */
  lockedReasons: Readonly<Record<string, string>>;
  /** The single "up next" module (in progress or next unlocked). */
  nextModuleId: string | undefined;
  badges: readonly AchievementBadgeData[];
  finalAssessment: {
    status: ProgressStatus;
    lockedReason?: string | undefined;
    scorePercent?: number | undefined;
    /** Number of questions (about 15, configurable). */
    questionCount?: number | undefined;
    /** Extra line under the card text, e.g. "You can try again at 14:05." */
    note?: string | undefined;
  };
  /** Whole-page loading/error; `ready` otherwise. */
  state?: 'ready' | 'loading' | 'error' | 'empty' | undefined;
  /** Replaces the default error text (for example when the network is unreachable). */
  errorDescription?: string | undefined;
  /** A non-blocking note above the content (for example: working offline). */
  notice?: { tone: 'info' | 'caution'; text: string } | undefined;
  onRetry?: (() => void) | undefined;

  onOpenModule: (moduleId: string) => void;
  onOpenBadge?: ((badgeId: string) => void) | undefined;
  onStartFinalAssessment: () => void;
  /** Sidebar routes: "dashboard" | "modules" | "badges" | "final". */
  onNavigate: (navId: string) => void;
  onOpenSettings?: (() => void) | undefined;
  onSignOut?: (() => void) | undefined;
}
