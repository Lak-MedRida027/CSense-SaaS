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
  };
  /** Whole-page loading/error; `ready` otherwise. */
  state?: 'ready' | 'loading' | 'error' | undefined;
  onRetry?: (() => void) | undefined;

  onOpenModule: (moduleId: string) => void;
  onOpenBadge?: ((badgeId: string) => void) | undefined;
  onStartFinalAssessment: () => void;
  /** Sidebar routes: "dashboard" | "modules" | "badges" | "final". */
  onNavigate: (navId: string) => void;
  onOpenSettings?: (() => void) | undefined;
  onSignOut?: (() => void) | undefined;
}
