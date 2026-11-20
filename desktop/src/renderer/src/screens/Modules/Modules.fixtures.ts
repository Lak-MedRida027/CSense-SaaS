import { fixtureModules, lockedReasonFor, placeholder } from '../shared.fixtures';
import type { ModulesScreenProps } from './Modules.types';

export const modulesFixture: ModulesScreenProps = {
  employee: { name: 'Amina Benali' },
  modules: fixtureModules,
  lockedReasons: Object.fromEntries(
    fixtureModules
      .filter((m) => m.status === 'locked')
      .map((m) => [m.id, lockedReasonFor(m.order)]),
  ),
  onOpenModule: placeholder,
  onNavigate: placeholder,
  onOpenSettings: placeholder,
  onSignOut: placeholder,
  onRetry: placeholder,
};
export const modulesLoadingFixture: ModulesScreenProps = { ...modulesFixture, state: 'loading' };
export const modulesEmptyFixture: ModulesScreenProps = {
  ...modulesFixture,
  modules: [],
  state: 'empty',
};
export const modulesErrorFixture: ModulesScreenProps = {
  ...modulesFixture,
  state: 'error',
  errorDescription: "Can't reach CSense. Check your connection and try again.",
};
