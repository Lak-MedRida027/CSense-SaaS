import { DEFAULT_PASSING_SCORE, EXPECTED_MODULE_COUNT, LEVELS } from '@csense/shared';
import type { OnboardingScreenProps } from './Onboarding.types';

const placeholder = (): void => undefined;

export const onboardingFixture: OnboardingScreenProps = {
  employeeName: 'Amina',
  moduleCount: EXPECTED_MODULE_COUNT,
  passMarkPercent: DEFAULT_PASSING_SCORE,
  levels: LEVELS,
  onComplete: placeholder,
  onSkip: placeholder,
};
