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

export const employeeDashboardEmptyFixture: EmployeeDashboardScreenProps = {
  ...employeeDashboardFixture,
  modules: [],
  badges: [],
  lockedReasons: {},
  nextModuleId: undefined,
  state: 'empty',
};

export const employeeDashboardOfflineFixture: EmployeeDashboardScreenProps = {
  ...employeeDashboardFixture,
  state: 'error',
  errorDescription: "Can't reach CSense. Check your connection and try again.",
};

export const employeeDashboardCompleteFixture: EmployeeDashboardScreenProps = {
  ...employeeDashboardFixture,
  employee: { name: 'Amina Benali', level: 'Guardian', totalXP: 2100 },
  xp: { currentLevelFloorXP: 2000, nextLevelXP: 3500, nextLevel: 'Defender', thresholds },
  modules: fixtureModules.map((m) => ({ ...m, status: 'completed' as const, scorePercent: 90 })),
  lockedReasons: {},
  nextModuleId: undefined,
  badges: fixtureBadges.map((b) => ({ ...b, earned: true, earnedAt: '2026-10-30' })),
  finalAssessment: { status: 'completed', scorePercent: 93, questionCount: 15 },
};

export const employeeDashboardLoadingFixture: EmployeeDashboardScreenProps = {
  ...employeeDashboardFixture,
  state: 'loading',
};
