import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { CSenseBridgeV1 } from '../../../shared/ipcChannels';
import { createLearningStore, type LearningState, type LearningStore } from './data/learningStore';
import { createAppStore, type AppState, type AppStore } from './store';

interface AppContextValue {
  bridge: CSenseBridgeV1;
  store: AppStore;
  learning: LearningStore;
}

const AppContext = createContext<AppContextValue | null>(null);

/** Gives the whole tree the bridge and the store, so auth/session state is never prop-drilled. */
export function AppProvider({ bridge, children }: { bridge: CSenseBridgeV1; children: ReactNode }) {
  const value = useMemo<AppContextValue>(
    () => ({ bridge, store: createAppStore(bridge), learning: createLearningStore(bridge) }),
    [bridge],
  );
  // start/stop are restartable, so StrictMode's mount/unmount/mount cycle is safe.
  useEffect(() => {
    value.store.start();
    // Cached learning data belongs to one employee: any change of identity or sign-out clears it (E12).
    let userId = value.store.getState().session.user?.id;
    const unsubscribe = value.store.subscribe(() => {
      const next = value.store.getState().session.user?.id;
      if (next !== userId) {
        userId = next;
        value.learning.clear();
      }
    });
    return () => {
      unsubscribe();
      value.store.stop();
    };
  }, [value]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppProvider is missing');
  return ctx;
}

export function useBridge(): CSenseBridgeV1 {
  return useAppContext().bridge;
}

export function useAppStore(): AppStore {
  return useAppContext().store;
}

export function useAppState(): AppState {
  const { store } = useAppContext();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

export function useLearningStore(): LearningStore {
  return useAppContext().learning;
}

/** The cached overview, XP and badges, re-rendering on change. */
export function useLearningState(): LearningState {
  const { learning } = useAppContext();
  return useSyncExternalStore(learning.subscribe, learning.getState, learning.getState);
}
