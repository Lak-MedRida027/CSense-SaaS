import { placeholder } from '../shared.fixtures';
import type { FinalAssessmentScreenProps } from './FinalAssessment.types';

const base: FinalAssessmentScreenProps = {
  employee: { name: 'Amina Benali' },
  onStart: placeholder,
  onBackToDashboard: placeholder,
  onNavigate: placeholder,
  onOpenSettings: placeholder,
  onSignOut: placeholder,
  onRetry: placeholder,
};
const info = {
  title: 'Final assessment',
  questionCount: 15,
  passMarkPercent: 70,
  attemptNumber: 1,
} as const;

export const finalLockedFixture: FinalAssessmentScreenProps = {
  ...base,
  final: { ...info, status: 'locked', lockedReason: 'Pass 3 more modules to unlock' },
};
export const finalAvailableFixture: FinalAssessmentScreenProps = {
  ...base,
  final: { ...info, status: 'unlocked' },
};
export const finalCooldownFixture: FinalAssessmentScreenProps = {
  ...base,
  final: {
    ...info,
    status: 'in_progress',
    attemptNumber: 3,
    startBlocked: { reason: 'You can try again at 14:05.' },
  },
};
export const finalCompletedFixture: FinalAssessmentScreenProps = {
  ...base,
  final: { ...info, status: 'completed', scorePercent: 93, completedOn: '30 Oct 2026' },
};
export const finalNoneFixture: FinalAssessmentScreenProps = { ...base, state: 'empty' };
export const finalLoadingFixture: FinalAssessmentScreenProps = { ...base, state: 'loading' };
export const finalErrorFixture: FinalAssessmentScreenProps = { ...base, state: 'error' };
