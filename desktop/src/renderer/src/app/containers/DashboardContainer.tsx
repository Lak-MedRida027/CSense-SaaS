import { LEVELS, type Level } from '@csense/shared';
import { useAppState } from '../AppProvider';
import { loadErrorMessage } from '../messages';
import {
  isLevel,
  lockedReasonsById,
  toBadgeData,
  toFinalCard,
  toModuleCardData,
} from '../learning/mappers';
import { EmployeeDashboardScreen } from '../../screens/EmployeeDashboard';
import { useWorkspace } from '../WorkspaceContext';
import { combineSlices, useLearningView, useShellProps } from './shell';

/** Dashboard over `GET /modules`, `/me/xp` and `/me/badges`, read in parallel (plan 4.1). */
export function DashboardContainer() {
  const shell = useShellProps();
  const ws = useWorkspace();
  const { gate, session } = useAppState();
  const { state, reload } = useLearningView(['overview', 'xp', 'badges']);
  const { overview, xp, badges } = state;
  const combined = combineSlices([overview, xp]);

  const levelName = xp.data?.level ?? session.user?.level;
  const level: Level = isLevel(levelName) ? levelName : LEVELS[0];
  const modules = overview.data?.modules ?? [];
  const badgeByModule = new Map((badges.data?.items ?? []).map((b) => [b.moduleId, b.name]));
  const empty = combined.state === 'ready' && modules.length === 0;

  return (
    <EmployeeDashboardScreen
      {...shell}
      employee={{
        name: shell.employee.name,
        level,
        totalXP: xp.data?.totalXP ?? session.user?.totalXP ?? 0,
      }}
      xp={{
        currentLevelFloorXP: xp.data?.currentLevelFloorXP ?? 0,
        nextLevelXP: xp.data?.nextLevelXP ?? undefined,
        nextLevel: xp.data?.nextLevel ?? undefined,
        ...(xp.data ? { thresholds: xp.data.thresholds } : {}),
      }}
      modules={modules.map((m) => toModuleCardData(m, badgeByModule.get(m.id)))}
      lockedReasons={lockedReasonsById(modules)}
      nextModuleId={overview.data?.nextModuleId ?? undefined}
      badges={(badges.data?.items ?? []).map(toBadgeData)}
      finalAssessment={toFinalCard(
        overview.data?.finalTest ?? null,
        overview.data?.totalModules ?? 0,
      )}
      state={empty ? 'empty' : combined.state}
      errorDescription={loadErrorMessage(combined.error, 'Your dashboard')}
      notice={
        gate?.releasedOffline
          ? {
              tone: 'caution',
              text: 'You are working offline. CSense will lock again when it reconnects.',
            }
          : undefined
      }
      onRetry={reload}
      onOpenModule={(moduleId) => {
        ws.dispatch({ type: 'openModule', moduleId });
      }}
      onStartFinalAssessment={() => {
        ws.dispatch({ type: 'nav', navId: 'final' });
      }}
    />
  );
}
