import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { CSenseBridgeV1 } from '../../../shared/ipcChannels';
import { createAppStore, type AppState, type AppStore } from './store';

interface AppContextValue {
  bridge: CSenseBridgeV1;
  store: AppStore;
}

const AppContext = createContext<AppContextValue | null>(null);

/** Gives the whole tree the bridge and the store, so auth/session state is never prop-drilled. */
export function AppProvider({ bridge, children }: { bridge: CSenseBridgeV1; children: ReactNode }) {
  const value = useMemo<AppContextValue>(
    () => ({ bridge, store: createAppStore(bridge) }),
    [bridge],
  );
  // start/stop are restartable, so StrictMode's mount/unmount/mount cycle is safe.
  useEffect(() => {
    value.store.start();
    return () => {
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
