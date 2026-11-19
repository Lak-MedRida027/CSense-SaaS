import { useCallback, useEffect, useState } from 'react';
import type { FinalTestOverviewDTO } from '../../../../shared/dto';
import type { DesktopError } from '../../../../shared/ipcChannels';
import { FinalAssessmentScreen, type FinalAssessmentInfo } from '../../screens/FinalAssessment';
import { useBridge } from '../AppProvider';
import { startBlockedReason, toFinalTarget } from '../learning/mappers';
import { loadErrorMessage } from '../messages';
import { useWorkspace } from '../WorkspaceContext';
import { useShellProps } from './shell';

type Load =
  | { status: 'loading' }
  | { status: 'error'; error: DesktopError | null }
  | { status: 'none' }
  | { status: 'ready'; data: FinalTestOverviewDTO };

function toInfo(f: FinalTestOverviewDTO): FinalAssessmentInfo {
  const done = f.passed || f.status === 'completed';
  const blocked = startBlockedReason(f);
  const date = f.completedAt ? new Date(f.completedAt) : null;
  return {
    status: done ? 'completed' : f.status,
    title: f.title,
    questionCount: f.questionCount,
    passMarkPercent: f.passingScore,
    attemptNumber: f.nextAttemptNumber,
    ...(f.status === 'locked'
      ? {
          lockedReason:
            f.remainingModules > 0
              ? `Pass ${String(f.remainingModules)} more module${f.remainingModules === 1 ? '' : 's'} to unlock.`
              : 'Complete every module to unlock the final assessment.',
        }
      : {}),
    ...(done && f.bestScore !== null ? { scorePercent: f.bestScore } : {}),
    ...(done && date && !Number.isNaN(date.getTime())
      ? {
          completedOn: date.toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          }),
        }
      : {}),
    ...(!done && blocked ? { startBlocked: { reason: blocked } } : {}),
  };
}

export function FinalAssessmentContainer() {
  const bridge = useBridge();
  const shell = useShellProps();
  const ws = useWorkspace();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const run = { stale: false };
    void (async () => {
      setLoad({ status: 'loading' });
      try {
        const res = await bridge.learning.getFinalTestOverview();
        if (run.stale) return;
        if (res.ok) setLoad({ status: 'ready', data: res.data });
        else if (res.error.code === 'NOT_FOUND') setLoad({ status: 'none' });
        else setLoad({ status: 'error', error: res.error });
      } catch {
        if (!run.stale) setLoad({ status: 'error', error: null });
      }
    })();
    return () => {
      run.stale = true;
    };
  }, [bridge, attempt]);

  const retry = useCallback(() => {
    setAttempt((a) => a + 1);
  }, []);

  return (
    <FinalAssessmentScreen
      {...shell}
      state={load.status === 'ready' ? 'ready' : load.status === 'none' ? 'empty' : load.status}
      errorDescription={loadErrorMessage(
        load.status === 'error' ? load.error : null,
        'The final assessment',
      )}
      final={load.status === 'ready' ? toInfo(load.data) : undefined}
      onRetry={retry}
      onBackToDashboard={() => {
        ws.dispatch({ type: 'nav', navId: 'dashboard' });
      }}
      onStart={() => {
        if (load.status !== 'ready') return;
        ws.dispatch({
          type: 'startQuiz',
          target: toFinalTarget(load.data),
          returnTo: { name: 'final' },
        });
      }}
    />
  );
}
