import { loadErrorMessage } from '../messages';
import { toBadgeData } from '../learning/mappers';
import { BadgesScreen } from '../../screens/Badges';
import { combineSlices, useLearningView, useShellProps } from './shell';

export function BadgesContainer() {
  const shell = useShellProps();
  const { state, reload } = useLearningView(['badges']);
  const combined = combineSlices([state.badges]);
  return (
    <BadgesScreen
      {...shell}
      badges={(state.badges.data?.items ?? []).map(toBadgeData)}
      state={combined.state}
      errorDescription={loadErrorMessage(combined.error, 'Your badges')}
      onRetry={reload}
    />
  );
}
