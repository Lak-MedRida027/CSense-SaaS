/**
 * Composition of the real controllers over the fakes, for controller tests.
 */
import type { GateStatusDTO } from '@csense/shared';
import type { GateView, MainEvent } from '../../shared/ipcChannels';
import { ApiClient } from '../api/client';
import type { DesktopConfig } from '../config';
import { GateController } from '../gate/gateController';
import { GateStateStore } from '../gate/gateStateStore';
import { OfflineReporter } from '../gate/offlineReporter';
import { AppLock } from '../lock/appLock';
import { CoverManager } from '../lock/covers';
import { LockdownController } from '../lockdown/lockdownController';
import { SessionService } from '../session/sessionService';
import { TokenStore } from '../session/tokenStore';
import {
  FakeApi,
  FakeClipboard,
  FakeDisplays,
  FakeFs,
  FakeGlobalShortcut,
  FakePower,
  FakeSafeStorage,
  FakeWindow,
  apiError,
  jsonReply,
  recordingLogger,
} from './fakes';

export const OID = {
  user: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  module1: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  session1: 'cccccccccccccccccccccccc',
  session2: 'dddddddddddddddddddddddd',
  q1: '111111111111111111111111',
  q2: '222222222222222222222222',
  challenge1: 'e1e1e1e1e1e1e1e1e1e1e1e1',
  challenge2: 'e2e2e2e2e2e2e2e2e2e2e2e2',
} as const;

export const testConfig: Pick<
  DesktopConfig,
  | 'apiBaseUrl'
  | 'configError'
  | 'gateOfflinePolicy'
  | 'gateOfflineGraceSeconds'
  | 'gateRestrictedPollSeconds'
  | 'lockdownMaxFocusLosses'
  | 'lockdownFocusAwaySeconds'
  | 'reminders'
> = {
  apiBaseUrl: 'https://api.test/api/v1',
  configError: null,
  gateOfflinePolicy: 'open_after_grace',
  gateOfflineGraceSeconds: 120,
  gateRestrictedPollSeconds: 60,
  lockdownMaxFocusLosses: 3,
  lockdownFocusAwaySeconds: 15,
  reminders: { firstDelayMinutes: 120, intervalMinutes: 240, maxPerDay: 2 },
};

export function challengeStatus(
  remaining = 3,
  challengeId: string = OID.challenge1,
): GateStatusDTO {
  return {
    state: 'challenge',
    maxAttempts: 3,
    attemptsRemaining: remaining,
    challenge: { challengeId, prompt: `Question ${challengeId}`, options: ['A', 'B', 'C'] },
    clearedUntil: null,
    restricted: null,
  };
}

export function grantedStatus(clearedUntil: string): GateStatusDTO {
  return {
    state: 'granted',
    maxAttempts: 3,
    attemptsRemaining: 3,
    challenge: null,
    clearedUntil,
    restricted: null,
  };
}

export const requiredStatus: GateStatusDTO = {
  state: 'required',
  maxAttempts: 3,
  attemptsRemaining: 3,
  challenge: null,
  clearedUntil: null,
  restricted: null,
};

export const restrictedStatus: GateStatusDTO = {
  state: 'restricted',
  maxAttempts: 3,
  attemptsRemaining: 0,
  challenge: null,
  clearedUntil: null,
  restricted: { referenceId: 'GATE-20261110-ABC123', since: '2026-11-10T09:00:00.000Z' },
};

export function loginBody(n = 1, role: 'employee' | 'administrator' = 'employee') {
  return {
    tokenType: 'Bearer',
    accessToken: `access-token-${String(n)}`,
    accessTokenExpiresIn: 900,
    refreshToken: `refresh-token-${String(n)}`,
    refreshTokenExpiresAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    user: {
      id: OID.user,
      name: 'Test User',
      role,
      ...(role === 'employee' ? { level: 'Apprentice', totalXP: 0 } : {}),
    },
  };
}

export function sessionDto(id: string = OID.session1, expiresInMs = 60 * 60_000) {
  return {
    sessionId: id,
    kind: 'Quiz',
    assessmentId: 'ffffffffffffffffffffffff',
    moduleId: OID.module1,
    title: 'Module 1 quiz',
    passingScore: 70,
    attemptNumber: 1,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    questions: [
      { questionId: OID.q1, text: 'Q1?', options: ['a', 'b', 'c'] },
      { questionId: OID.q2, text: 'Q2?', options: ['a', 'b', 'c'] },
    ],
  };
}

export function attemptDto(endReason = 'submitted', score = 100) {
  return {
    attemptId: '999999999999999999999999',
    kind: 'Quiz',
    assessmentId: 'ffffffffffffffffffffffff',
    moduleId: OID.module1,
    attemptNumber: 1,
    endReason,
    score,
    passed: score >= 70,
    correctCount: 2,
    totalCount: 2,
    passingScore: 70,
    attemptedAt: new Date().toISOString(),
    review: [],
    progression: { moduleCompleted: false, nextModuleId: null, finalTestUnlocked: false },
    effects: {},
  };
}

export interface World {
  fs: FakeFs;
  safeStorage: FakeSafeStorage;
  fakeApi: FakeApi;
  tokens: TokenStore;
  api: ApiClient;
  sessionEnded: string[];
  events: MainEvent[];
  gateViews: GateView[];
  session: SessionService;
  window: FakeWindow;
  displays: FakeDisplays;
  clipboard: FakeClipboard;
  shortcut: FakeGlobalShortcut;
  power: FakePower;
  lock: AppLock;
  gate: GateController;
  gateState: GateStateStore;
  offlineReports: OfflineReporter;
  lockdown: LockdownController;
  log: ReturnType<typeof recordingLogger>;
  config: typeof testConfig;
}

export const SESSION_FILE = '/data/session.v1.json';
export const PENDING_FILE = '/data/pending.json';
export const GATE_STATE_FILE = '/data/gate-state.v1.json';
export const OFFLINE_REPORTS_FILE = '/data/offline-releases.v1.json';

export function makeWorld(overrides: Partial<typeof testConfig> = {}): World {
  const config = { ...testConfig, ...overrides };
  const fs = new FakeFs();
  const safeStorage = new FakeSafeStorage();
  const fakeApi = new FakeApi();
  const log = recordingLogger();
  const tokens = new TokenStore({ fs, safeStorage, filePath: SESSION_FILE, log });
  const sessionEnded: string[] = [];
  const events: MainEvent[] = [];
  const gateViews: GateView[] = [];
  const late: { session?: SessionService; lockdown?: LockdownController } = {};
  const api = new ApiClient({
    baseUrl: fakeApi.baseUrl,
    fetch: fakeApi.fetch,
    tokens,
    log,
    onSessionEnded: (reason) => {
      sessionEnded.push(reason);
      late.session?.handleEnded(reason);
    },
  });
  const session = new SessionService({
    api,
    tokens,
    log,
    emit: (view) => {
      events.push({ type: 'session', view });
    },
  });
  const window = new FakeWindow();
  const displays = new FakeDisplays();
  const clipboard = new FakeClipboard();
  const shortcut = new FakeGlobalShortcut();
  const power = new FakePower();
  late.session = session;
  const lock = new AppLock({
    window,
    covers: new CoverManager(displays),
    clipboard,
    globalShortcut: shortcut,
    log,
    onBlockedInput: (p) => {
      if (p === 'lockdown') late.lockdown?.noteBlockedInput();
    },
  });
  const gateState = new GateStateStore({ fs, safeStorage, filePath: GATE_STATE_FILE, log });
  const offlineReports = new OfflineReporter({
    api,
    fs,
    safeStorage,
    filePath: OFFLINE_REPORTS_FILE,
    log,
  });
  const gate = new GateController({
    config,
    lock,
    api,
    session,
    power,
    gateState,
    offlineReports,
    log,
    emit: (v) => {
      gateViews.push(v);
      events.push({ type: 'gate', view: v });
    },
  });
  const lockdown = new LockdownController({
    config,
    lock,
    window,
    api,
    fs,
    pendingPath: PENDING_FILE,
    currentUserId: () => session.getUser()?.id ?? null,
    emit: (e) => {
      events.push(e);
    },
    log,
    gate,
  });
  late.lockdown = lockdown;
  gate.attachLockdown(lockdown);
  return {
    fs,
    safeStorage,
    fakeApi,
    tokens,
    api,
    sessionEnded,
    events,
    gateViews,
    session,
    window,
    displays,
    clipboard,
    shortcut,
    power,
    lock,
    gate,
    lockdown,
    gateState,
    offlineReports,
    log,
    config,
  };
}

/** Routes for a signed-in employee with a configurable gate status. */
export function installAuthRoutes(
  w: World,
  opts: { role?: 'employee' | 'administrator'; status?: () => GateStatusDTO } = {},
): { logins: number; refreshes: number } {
  const counts = { logins: 0, refreshes: 0 };
  const role = opts.role ?? 'employee';
  w.fakeApi.on('POST /auth/login', (req) => {
    const body = req.body as { password?: string };
    if (body.password !== 'correct-password') return apiError(401, 'INVALID_CREDENTIALS');
    counts.logins++;
    return jsonReply(200, loginBody(1, role));
  });
  w.fakeApi.on('POST /auth/refresh', () => {
    counts.refreshes++;
    const b = loginBody(counts.refreshes + 1, role);
    const { user: _user, ...tokens } = b;
    return jsonReply(200, tokens);
  });
  w.fakeApi.on('POST /auth/logout', { status: 204 });
  w.fakeApi.on('GET /auth/me', () => jsonReply(200, loginBody(1, role).user));
  if (opts.status) {
    const status = opts.status;
    w.fakeApi.on('GET /gate/status', () => jsonReply(200, status()));
    w.fakeApi.on('POST /gate/challenge', () => jsonReply(200, status()));
  }
  return counts;
}

export const farFuture = (): string => new Date(Date.now() + 6 * 3600_000).toISOString();
