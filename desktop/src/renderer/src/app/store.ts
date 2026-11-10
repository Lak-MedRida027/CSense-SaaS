/**
 * The renderer's small app store (plan 9): session, gate and lockdown state mirrored from the main
 * process. Main is the source of truth; this only caches what events and the initial reads say, so
 * nothing is prop-drilled and nothing here ever holds a token (the bridge has none to give).
 */
import type {
  CSenseBridgeV1,
  GateView,
  LockdownEndReason,
  LockdownStateName,
  MainEvent,
  SecureSessionView,
  SessionView,
} from '../../../shared/ipcChannels';

export interface LockdownInfo {
  state: LockdownStateName;
  sessionId: string | null;
  /** Why the last lockdown ended (set on `inactive`). */
  endReason?: LockdownEndReason | undefined;
}

export interface Violation {
  kind: 'focus_lost' | 'devtools' | 'blocked_shortcut';
  count: number;
  remaining: number;
}

export interface AppState {
  ready: boolean;
  session: SessionView;
  gate: GateView | null;
  lockdown: LockdownInfo;
  violation: Violation | null;
  /** A session main still holds after a renderer reload (crash recovery). */
  resume: SecureSessionView | null;
  /** Bumped by `navigate` events (notification clicks) so the router can go home. */
  homeRequests: number;
  appVersion: string;
}

export interface AppStore {
  getState: () => AppState;
  subscribe: (listener: () => void) => () => void;
  /** Local-only: forget the resumed session once the quiz container has taken it. */
  clearResume: () => void;
  clearViolation: () => void;
  /** Subscribe to main's events and read the initial state. Safe to call again after `stop`. */
  start: () => void;
  stop: () => void;
}

const INITIAL_SESSION: SessionView = { status: 'unknown', persistence: 'memory_only' };

export function createAppStore(bridge: CSenseBridgeV1): AppStore {
  let state: AppState = {
    ready: false,
    session: INITIAL_SESSION,
    gate: null,
    lockdown: { state: 'inactive', sessionId: null },
    violation: null,
    resume: null,
    homeRequests: 0,
    appVersion: bridge.appVersion,
  };
  const listeners = new Set<() => void>();
  // Events that arrived before the initial reads settle win over those reads.
  let seen = { session: false, gate: false, lockdown: false };
  let unsubscribe: (() => void) | null = null;
  let generation = 0;

  const set = (patch: Partial<AppState>): void => {
    state = { ...state, ...patch };
    for (const l of [...listeners]) l();
  };

  const onEvent = (e: MainEvent): void => {
    switch (e.type) {
      case 'session':
        seen.session = true;
        set({ session: e.view });
        break;
      case 'gate':
        seen.gate = true;
        set({ gate: e.view });
        break;
      case 'lockdown':
        seen.lockdown = true;
        set({
          lockdown: { state: e.state, sessionId: e.sessionId, endReason: e.reason },
          // A fresh lockdown starts with a clean warning slate.
          ...(e.state === 'entering' || e.state === 'inactive' ? { violation: null } : {}),
        });
        break;
      case 'lockdown-violation':
        set({ violation: { kind: e.kind, count: e.count, remaining: e.remaining } });
        break;
      case 'navigate':
        set({ homeRequests: state.homeRequests + 1 });
        break;
    }
  };

  const start = (): void => {
    if (unsubscribe) return;
    const gen = ++generation;
    seen = { session: false, gate: false, lockdown: false };
    unsubscribe = bridge.events.subscribe(onEvent);
    void Promise.all([bridge.session.getState(), bridge.gate.getView(), bridge.assessment.resume()])
      .then(([session, gate, resume]) => {
        if (gen !== generation) return;
        set({
          ready: true,
          session: seen.session ? state.session : session,
          gate: seen.gate ? state.gate : gate,
          resume,
          ...(resume && !seen.lockdown
            ? { lockdown: { state: 'active' as const, sessionId: resume.session.sessionId } }
            : {}),
        });
      })
      .catch(() => {
        if (gen === generation) set({ ready: true });
      });
  };

  return {
    getState: () => state,
    subscribe: (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    clearResume: () => {
      if (state.resume) set({ resume: null });
    },
    clearViolation: () => {
      if (state.violation) set({ violation: null });
    },
    start,
    stop: () => {
      generation++;
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
