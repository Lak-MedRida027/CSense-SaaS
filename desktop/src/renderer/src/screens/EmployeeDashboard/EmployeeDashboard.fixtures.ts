import type { EmployeeDashboardScreenProps } from './EmployeeDashboard.types';
import { fixtureBadges, fixtureModules, lockedReasonFor, placeholder } from '../shared.fixtures';

/** XP numbers follow the proposed (unconfirmed, D9) thresholds; real values come from /shared. */
const thresholds = { Apprentice: 0, Aware: 300, Practitioner: 900, Guardian: 2000, Defender: 3500 };

const lockedReasons = Object.fromEntries(
  fixtureModules.filter((m) => m.status === 'locked').map((m) => [m.id, lockedReasonFor(m.order)]),
);

const callbacks = {
  onOpenModule: placeholder,
  onOpenBadge: placeholder,
  onStartFinalAssessment: placeholder,
  onNavigate: placeholder,
  onOpenSettings: placeholder,
  onSignOut: placeholder,
  onRetry: placeholder,
};

export const employeeDashboardFixture: EmployeeDashboardScreenProps = {
  ...callbacks,
  employee: { name: 'Amina Benali', level: 'Practitioner', totalXP: 1240 },
  xp: { currentLevelFloorXP: 900, nextLevelXP: 2000, nextLevel: 'Guardian', thresholds },
  modules: fixtureModules,
  lockedReasons,
  nextModuleId: 'm4',
  badges: fixtureBadges,
  finalAssessment: {
    status: 'locked',
    lockedReason: `Unlocks after all ${fixtureModules.length} modules`,
    questionCount: 15,
  },
};

/** First-time employee: nothing started yet. */
export const employeeDashboardFirstRunFixture: EmployeeDashboardScreenProps = {
  ...employeeDashboardFixture,
  employee: { name: 'Karim Diaz', level: 'Apprentice', totalXP: 0 },
  xp: { currentLevelFloorXP: 0, nextLevelXP: 300, nextLevel: 'Aware', thresholds },
  modules: fixtureModules.map((m) => ({
    ...m,
    status: m.order === 1 ? ('unlocked' as const) : ('locked' as const),
    scorePercent: undefined,
  })),
  lockedReasons: Object.fromEntries(
    fixtureModules.filter((m) => m.order > 1).map((m) => [m.id, lockedReasonFor(m.order)]),
  ),
  nextModuleId: 'm1',
  badges: fixtureBadges.map((b) => ({ ...b, earned: false, earnedAt: undefined })),
};

export const employeeDashboardLoadingFixture: EmployeeDashboardScreenProps = {
  ...employeeDashboardFixture,
  state: 'loading',
};
