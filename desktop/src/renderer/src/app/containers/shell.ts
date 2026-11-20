import { useEffect } from 'react';
import type { DesktopError } from '../../../../shared/ipcChannels';
import { useAppState, useLearningState, useLearningStore } from '../AppProvider';
import type { LearningKey, Slice } from '../data/learningStore';
import { useWorkspace } from '../WorkspaceContext';

/** Props every AppShell page shares: who is signed in, navigation, settings, sign out. */
export function useShellProps() {
  const { session } = useAppState();
  const ws = useWorkspace();
  return {
    employee: { name: session.user?.name ?? '' },
    onNavigate: (navId: string) => {
      ws.dispatch({ type: 'nav', navId });
    },
    onOpenSettings: ws.openSettings,
    onSignOut: ws.signOut,
  };
}

/** Re-reads the given slices when a view mounts (and on demand), then returns the cached state. */
export function useLearningView(keys: readonly LearningKey[]) {
  const store = useLearningStore();
  const state = useLearningState();
  const keyList = keys.join(',');
  useEffect(() => {
    void store.refresh(keyList.split(',') as LearningKey[]);
  }, [store, keyList]);
  return {
    state,
    reload: () => {
      void store.refresh(keys);
    },
  };
}

export type CombinedState = { state: 'ready' | 'loading' | 'error'; error: DesktopError | null };

/** One state for several slices: an error only when a slice has nothing to show. */
export function combineSlices(slices: readonly Slice<unknown>[]): CombinedState {
  const failed = slices.find((s) => s.status === 'error' && s.data === null);
  if (failed) return { state: 'error', error: failed.error };
  if (slices.some((s) => s.data === null)) return { state: 'loading', error: null };
  return { state: 'ready', error: null };
}
