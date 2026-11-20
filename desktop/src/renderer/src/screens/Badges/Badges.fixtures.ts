import { fixtureBadges, placeholder } from '../shared.fixtures';
import type { BadgesScreenProps } from './Badges.types';

export const badgesFixture: BadgesScreenProps = {
  employee: { name: 'Amina Benali' },
  badges: fixtureBadges,
  onNavigate: placeholder,
  onOpenSettings: placeholder,
  onSignOut: placeholder,
  onRetry: placeholder,
};
export const badgesLoadingFixture: BadgesScreenProps = { ...badgesFixture, state: 'loading' };
export const badgesEmptyFixture: BadgesScreenProps = { ...badgesFixture, badges: [] };
export const badgesErrorFixture: BadgesScreenProps = { ...badgesFixture, state: 'error' };
