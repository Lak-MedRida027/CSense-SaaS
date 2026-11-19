import { loadErrorMessage } from '../messages';
import { lockedReasonsById, toModuleCardData } from '../learning/mappers';
import { ModulesScreen } from '../../screens/Modules';
import { useWorkspace } from '../WorkspaceContext';
import { combineSlices, useLearningView, useShellProps } from './shell';

export function ModulesContainer() {
  const shell = useShellProps();
  const ws = useWorkspace();
  const { state, reload } = useLearningView(['overview', 'badges']);
  const combined = combineSlices([state.overview]);
  const modules = state.overview.data?.modules ?? [];
  const badgeByModule = new Map((state.badges.data?.items ?? []).map((b) => [b.moduleId, b.name]));
  return (
    <ModulesScreen
      {...shell}
      modules={modules.map((m) => toModuleCardData(m, badgeByModule.get(m.id)))}
      lockedReasons={lockedReasonsById(modules)}
      state={combined.state === 'ready' && modules.length === 0 ? 'empty' : combined.state}
      errorDescription={loadErrorMessage(combined.error, 'Your modules')}
      onRetry={reload}
      onOpenModule={(moduleId) => {
        ws.dispatch({ type: 'openModule', moduleId });
      }}
    />
  );
}
