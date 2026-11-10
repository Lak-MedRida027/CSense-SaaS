import { vi, type Mock } from 'vitest';
import type { AssessmentSessionDTO, AttemptResultDTO } from '../../../../shared/dto';
import type {
  CSenseBridgeV1,
  GateView,
  MainEvent,
  Result,
  SecureSessionView,
  SessionView,
} from '../../../../shared/ipcChannels';

export const baseGateView: GateView = {
  phase: 'signed_out',
  autoContinue: false,
  admin: false,
  maxAttempts: 0,
  attemptsRemaining: 0,
  challenge: null,
  clearedUntil: null,
  restricted: null,
  offline: null,
  feedback: null,
  releasedOffline: false,
};

export const gateView = (patch: Partial<GateView>): GateView => ({ ...baseGateView, ...patch });

export const challengeView = (patch: Partial<GateView> = {}): GateView =>
  gateView({
    phase: 'challenge',
    maxAttempts: 3,
    attemptsRemaining: 3,
    challenge: {
      challengeId: 'a'.repeat(24),
      prompt: 'An email asks for your password. What do you do?',
      options: ['Reply with it', 'Report it', 'Forward it'],
    },
    ...patch,
  });

export const signedOut: SessionView = { status: 'signed_out', persistence: 'encrypted' };
export const signedInEmployee: SessionView = {
  status: 'signed_in',
  persistence: 'encrypted',
  user: { id: 'u1', name: 'Amina Benali', role: 'employee', level: 'Aware', totalXP: 320 },
};

export const OID = {
  module1: 'b'.repeat(24),
  session1: 'c'.repeat(24),
  q1: '1'.repeat(24),
  q2: '2'.repeat(24),
};

export const sessionDto = (): AssessmentSessionDTO => ({
  sessionId: OID.session1,
  kind: 'Quiz',
  assessmentId: 'f'.repeat(24),
  moduleId: OID.module1,
  title: 'Phishing basics',
  passingScore: 70,
  attemptNumber: 1,
  startedAt: '2026-11-10T09:00:00.000Z',
  expiresAt: '2026-11-10T10:00:00.000Z',
  questions: [
    {
      questionId: OID.q1,
      text: 'What is phishing?',
      options: ['A fish', 'A scam email', 'A game'],
    },
    { questionId: OID.q2, text: 'Who do you tell?', options: ['Nobody', 'Security', 'Everyone'] },
  ],
});

export const attemptDto = (over: Partial<AttemptResultDTO> = {}): AttemptResultDTO => ({
  attemptId: 'd'.repeat(24),
  kind: 'Quiz',
  assessmentId: 'f'.repeat(24),
  moduleId: OID.module1,
  attemptNumber: 1,
  endReason: 'submitted',
  score: 100,
  passed: true,
  correctCount: 2,
  totalCount: 2,
  passingScore: 70,
  attemptedAt: '2026-11-10T09:10:00.000Z',
  review: [],
  progression: { moduleCompleted: true, nextModuleId: null, finalTestUnlocked: false },
  effects: { xpEarned: 120 },
  ...over,
});

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const err = (code: string, extra: Record<string, unknown> = {}): Result<never> =>
  ({ ok: false, error: { code, message: code, ...extra } }) as Result<never>;

type Fn = Mock<(...args: never[]) => Promise<unknown>>;

export interface FakeBridge {
  bridge: CSenseBridgeV1;
  emit: (e: MainEvent) => void;
  mocks: {
    login: Fn;
    logout: Fn;
    submitAnswer: Fn;
    gateContinue: Fn;
    continueOffline: Fn;
    requestChallenge: Fn;
    startSecure: Fn;
    resume: Fn;
    submit: Fn;
    exit: Fn;
    getOverview: Fn;
    getQuizOverview: Fn;
  };
}

/** A scriptable `window.csense`. Defaults model a signed-out, locked workstation. */
export function createFakeBridge(
  initial: { session?: SessionView; gate?: GateView; resume?: SecureSessionView | null } = {},
): FakeBridge {
  let listener: ((e: MainEvent) => void) | null = null;
  const m = {
    login: vi.fn(() => Promise.resolve(ok(signedInEmployee))),
    logout: vi.fn(() => Promise.resolve(ok(undefined))),
    submitAnswer: vi.fn(() => Promise.resolve(err('INTERNAL'))),
    gateContinue: vi.fn(() => Promise.resolve(ok(undefined))),
    continueOffline: vi.fn(() => Promise.resolve(ok(undefined))),
    requestChallenge: vi.fn(() => Promise.resolve(ok(baseGateView))),
    startSecure: vi.fn(() => Promise.resolve(err('INTERNAL'))),
    resume: vi.fn(() => Promise.resolve(initial.resume ?? null)),
    submit: vi.fn(() => Promise.resolve(err('INTERNAL'))),
    exit: vi.fn(() => Promise.resolve(ok({ attempt: null }))),
    getOverview: vi.fn(() => Promise.resolve(err('INTERNAL'))),
    getQuizOverview: vi.fn(() => Promise.resolve(err('INTERNAL'))),
  };
  const bridge = {
    bridgeVersion: 1,
    appVersion: '0.0.0-test',
    session: {
      getState: () => Promise.resolve(initial.session ?? signedOut),
      login: m.login,
      logout: m.logout,
    },
    gate: {
      getView: () => Promise.resolve(initial.gate ?? baseGateView),
      requestChallenge: m.requestChallenge,
      submitAnswer: m.submitAnswer,
      continue: m.gateContinue,
      continueOffline: m.continueOffline,
    },
    assessment: {
      startSecure: m.startSecure,
      resume: m.resume,
      submit: m.submit,
      exit: m.exit,
    },
    learning: { getOverview: m.getOverview, getQuizOverview: m.getQuizOverview },
    events: {
      subscribe: (l: (e: MainEvent) => void) => {
        listener = l;
        return () => {
          if (listener === l) listener = null;
        };
      },
    },
  } as unknown as CSenseBridgeV1;
  return {
    bridge,
    emit: (e) => {
      listener?.(e);
    },
    mocks: m,
  };
}
