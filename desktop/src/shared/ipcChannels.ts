/**
 * Preload bridge v1: the channel inventory, result envelope and view types (ADR 0013).
 *
 * This file is imported by main, the preload AND the renderer, and the sandboxed preload cannot load
 * node modules, so it must stay dependency-free at runtime: type-only imports and constants only.
 * The strict zod input schemas for every channel live in `ipc.ts` (main only).
 */
import type {
  AssessmentSessionDTO,
  AttemptResultDTO,
  ErrorCode,
  LearningOverviewDTO,
  QuizOverviewDTO,
} from './dto';

export const IPC_PREFIX = 'csense:v1:';
export const IPC_EVENT_CHANNEL = `${IPC_PREFIX}event`;

/**
 * Every invoke channel, grouped by the bridge area it belongs to. The preload builds `window.csense`
 * from this table and main registers exactly these channels; `assertIpcRegistry` refuses to start
 * if the two differ. Adding a channel is a reviewed change (the inventory is snapshot-tested).
 */
export const IPC_CHANNELS_V1 = {
  session: ['getState', 'login', 'logout'],
  gate: ['getView', 'requestChallenge', 'submitAnswer', 'continue', 'continueOffline'],
  assessment: ['startSecure', 'resume', 'submit', 'exit'],
  learning: ['getOverview', 'getQuizOverview'],
} as const;

export type IpcArea = keyof typeof IPC_CHANNELS_V1;

/** Flat list of `csense:v1:<area>.<method>` channel names, in declaration order. */
export const IPC_CHANNEL_NAMES: readonly string[] = (
  Object.keys(IPC_CHANNELS_V1) as IpcArea[]
).flatMap((area) => IPC_CHANNELS_V1[area].map((m) => `${IPC_PREFIX}${area}.${m}`));

/** Bounds enforced before parsing (ADR 0013). */
export const IPC_MAX_PAYLOAD_BYTES = 64 * 1024;
export const IPC_MAX_CALLS_PER_SECOND = 20;

/** Desktop-side codes that never come from the server. */
export const DESKTOP_ERROR_CODES = [
  'NETWORK_UNAVAILABLE',
  'NOT_SIGNED_IN',
  'LOCKDOWN_REQUIRED',
  'LOCKDOWN_NOT_ACTIVE',
  'GATE_LOCKED',
  'INVALID_INPUT',
  'FORBIDDEN_SENDER',
  'BAD_RESPONSE',
  'MISCONFIGURED',
  'INTERNAL',
] as const;
export type DesktopOnlyErrorCode = (typeof DESKTOP_ERROR_CODES)[number];
export type DesktopErrorCode = ErrorCode | DesktopOnlyErrorCode;

export interface DesktopError {
  code: DesktopErrorCode;
  message: string;
  retryAfterSeconds?: number;
  details?: { retryAt?: string };
}

/** Results are values: exceptions (and their stacks) never cross IPC. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: DesktopError };

export interface SessionUserView {
  id: string;
  name: string;
  role: 'employee' | 'administrator';
  level?: string;
  totalXP?: number;
}

export interface SessionView {
  status: 'unknown' | 'signed_out' | 'signed_in';
  user?: SessionUserView;
  /** `memory_only` when OS encryption is unavailable: the user signs in at every launch. */
  persistence: 'encrypted' | 'memory_only';
  /** Set when the session was ended by the server or by expiry, so Login can say so. */
  endedNotice?: 'session_ended';
}

export const GATE_PHASES = [
  'boot',
  'signed_out',
  'checking',
  'challenge',
  'granted',
  'restricted',
  'offline',
  'released',
  'misconfigured',
] as const;
export type GatePhase = (typeof GATE_PHASES)[number];

/** Main's gate state machine as the renderer sees it (plan 6.6). No tokens, no key material. */
export interface GateView {
  phase: GatePhase;
  /** True when access was granted by an existing clearance (auto-continue after 2 s). */
  autoContinue: boolean;
  /** Administrators are released without a challenge. */
  admin: boolean;
  maxAttempts: number;
  attemptsRemaining: number;
  challenge: { challengeId: string; prompt: string; options: string[] } | null;
  clearedUntil: string | null;
  restricted: { referenceId: string; since: string } | null;
  offline: { since: string; graceElapsed: boolean; canContinueOffline: boolean } | null;
  /** Feedback for the last submitted answer. */
  feedback: { correct: boolean; explanation: string } | null;
  /** Released while offline: the gate re-locks as soon as the API answers. */
  releasedOffline: boolean;
}

export interface GateAnswerView {
  correct: boolean;
  explanation: string;
  xpEarned: number;
  view: GateView;
}

export interface SecureSessionView {
  session: AssessmentSessionDTO;
  /** True after a renderer crash/reload: answers given so far were lost. */
  resumed: boolean;
  remainingFocusLosses: number;
}

export type LockdownStateName = 'inactive' | 'entering' | 'active' | 'exiting' | 'failed';
export type LockdownEndReason =
  | 'submitted'
  | 'user_exit'
  | 'focus_lost'
  | 'crash'
  | 'hard_cap'
  | 'session_expired'
  | 'start_failed';

export type MainEvent =
  | { type: 'session'; view: SessionView }
  | { type: 'gate'; view: GateView }
  | {
      type: 'lockdown';
      state: LockdownStateName;
      sessionId: string | null;
      reason?: LockdownEndReason;
    }
  | {
      type: 'lockdown-violation';
      kind: 'focus_lost' | 'devtools' | 'blocked_shortcut';
      count: number;
      remaining: number;
    }
  | { type: 'navigate'; to: 'home' | { module: string } };

export type SecureStartInput = { kind: 'quiz'; moduleId: string } | { kind: 'final' };

export interface CSenseBridgeV1 {
  readonly bridgeVersion: 1;
  readonly appVersion: string;
  readonly session: {
    getState(): Promise<SessionView>;
    login(input: { email: string; password: string }): Promise<Result<SessionView>>;
    logout(): Promise<Result<void>>;
  };
  readonly gate: {
    getView(): Promise<GateView>;
    requestChallenge(): Promise<Result<GateView>>;
    submitAnswer(input: {
      challengeId: string;
      optionIndex: number;
    }): Promise<Result<GateAnswerView>>;
    continue(): Promise<Result<void>>;
    continueOffline(): Promise<Result<void>>;
  };
  readonly assessment: {
    startSecure(input: SecureStartInput): Promise<Result<SecureSessionView>>;
    resume(): Promise<SecureSessionView | null>;
    submit(input: {
      sessionId: string;
      answers: { questionId: string; selectedIndex: number | null }[];
    }): Promise<Result<AttemptResultDTO>>;
    exit(input: { sessionId: string }): Promise<Result<{ attempt: AttemptResultDTO | null }>>;
  };
  readonly learning: {
    getOverview(): Promise<Result<LearningOverviewDTO>>;
    getQuizOverview(input: { moduleId: string }): Promise<Result<QuizOverviewDTO>>;
  };
  readonly events: { subscribe(listener: (e: MainEvent) => void): () => void };
}
