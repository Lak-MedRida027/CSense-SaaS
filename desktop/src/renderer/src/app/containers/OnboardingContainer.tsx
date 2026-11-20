import { DEFAULT_PASSING_SCORE, LEVELS } from '@csense/shared';
import { OnboardingScreen } from '../../screens/Onboarding';
import { useAppState, useBridge } from '../AppProvider';
import { useWorkspace } from '../WorkspaceContext';
import { useLearningView } from './shell';

/**
 * First-run welcome (FR4). Completing or skipping is stored on the server through main; a failure
 * never blocks training: the user continues and sees a note (the intro shows again next launch).
 */
export function OnboardingContainer() {
  const bridge = useBridge();
  const ws = useWorkspace();
  const { session } = useAppState();
  const { state } = useLearningView(['overview']);
  const overview = state.overview.data;
  const firstName = (session.user?.name ?? '').split(' ')[0] ?? '';

  const finish = async (outcome: 'completed' | 'skipped'): Promise<void> => {
    let saved = false;
    try {
      saved = (await bridge.me.completeOnboarding({ outcome })).ok;
    } catch {
      saved = false;
    }
    if (!saved) {
      ws.toast('caution', 'Your welcome could not be saved. It may show again next time.');
    }
    const first = overview?.modules.find((m) => m.position === 1 && m.status !== 'locked');
    ws.dispatch({
      type: 'onboardingDone',
      openModuleId: outcome === 'completed' && first ? first.id : null,
    });
  };

  return (
    <OnboardingScreen
      employeeName={firstName}
      moduleCount={overview?.totalModules}
      passMarkPercent={DEFAULT_PASSING_SCORE}
      levels={LEVELS}
      onComplete={() => {
        void finish('completed');
      }}
      onSkip={() => {
        void finish('skipped');
      }}
    />
  );
}
