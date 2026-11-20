/**
 * Cache for the three server reads every employee view shares (plan 7.6): the learning overview,
 * the XP summary and the badges. Small external store, no library: views call `refresh` on mount and
 * after mutations; nothing refreshes on a timer (D5-24 rate budget).
 *
 * `clear()` drops everything and invalidates in-flight reads, so the next employee on a shared
 * workstation never sees the previous one's data (E12).
 */
import type { LearningOverviewDTO, MyBadgesDTO, XpSummaryDTO } from '../../../../shared/dto';
import type { CSenseBridgeV1, DesktopError, Result } from '../../../../shared/ipcChannels';

export type SliceStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface Slice<T> {
  status: SliceStatus;
  data: T | null;
  error: DesktopError | null;
}

export interface LearningState {
  overview: Slice<LearningOverviewDTO>;
  xp: Slice<XpSummaryDTO>;
  badges: Slice<MyBadgesDTO>;
}

export type LearningKey = keyof LearningState;
export const ALL_KEYS: readonly LearningKey[] = ['overview', 'xp', 'badges'];

export interface LearningStore {
  getState: () => LearningState;
  subscribe: (listener: () => void) => () => void;
  /** Re-reads the given slices in parallel. Never throws; failures land in the slice. */
  refresh: (keys?: readonly LearningKey[]) => Promise<void>;
  clear: () => void;
}

const idle = <T>(): Slice<T> => ({ status: 'idle', data: null, error: null });
const initial = (): LearningState => ({ overview: idle(), xp: idle(), badges: idle() });

const NETWORK_ERROR: DesktopError = { code: 'NETWORK_UNAVAILABLE', message: 'offline' };

export function createLearningStore(
  bridge: Pick<CSenseBridgeV1, 'learning' | 'me'>,
): LearningStore {
  let state = initial();
  let generation = 0;
  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const l of [...listeners]) l();
  };

  const readers: {
    [K in LearningKey]: () => Promise<Result<NonNullable<LearningState[K]['data']>>>;
  } = {
    overview: () => bridge.learning.getOverview(),
    xp: () => bridge.me.getXp(),
    badges: () => bridge.me.getBadges(),
  };

  const load = async (key: LearningKey, gen: number): Promise<void> => {
    let res: Result<unknown>;
    try {
      res = await readers[key]();
    } catch {
      res = { ok: false, error: NETWORK_ERROR };
    }
    if (gen !== generation) return;
    const prev = state[key];
    state = {
      ...state,
      [key]: res.ok
        ? { status: 'ready', data: res.data, error: null }
        : // Keep stale data on a failed refresh so a flaky network does not blank a screen.
          { status: prev.data ? 'ready' : 'error', data: prev.data, error: res.error },
    };
    emit();
  };

  return {
    getState: () => state,
    subscribe: (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    refresh: async (keys = ALL_KEYS) => {
      const gen = generation;
      state = {
        ...state,
        ...Object.fromEntries(
          keys.map((k) => [
            k,
            state[k].data ? state[k] : { status: 'loading', data: null, error: null },
          ]),
        ),
      };
      emit();
      await Promise.all(keys.map((k) => load(k, gen)));
    },
    clear: () => {
      generation++;
      state = initial();
      emit();
    },
  };
}
