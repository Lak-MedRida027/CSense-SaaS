/**
 * GateController (plan 6.6, ADR 0015): the pre-access gate state machine.
 *
 * Invariants:
 * - The window is locked BEFORE any request is made (`start`).
 * - Main alone decides release. `continue()` succeeds only from `granted`, a phase entered solely
 *   from a server response (or an administrator session) that main itself received (S16).
 * - Restricted is a full block until the server says otherwise (D5-5); a poll re-checks it.
 * - Offline follows D5-12: after a grace period an explicit "Continue offline" appears, and the gate
 *   re-locks as soon as the API answers and there is no clearance.
 * - A re-lock never interrupts an active lockdown; it is queued until lockdown exits (7.7).
 */
import type { GateStatusDTO } from '@csense/shared';
import type { GateAnswerView, GatePhase, GateView, Result } from '../../shared/ipcChannels';
import { ApiClient } from '../api/client';
import { OPERATIONS } from '../api/operations';
import type { DesktopConfig } from '../config';
import type { PowerPort } from '../electron/types';
import type { AppLock } from '../lock/appLock';
import type { Logger } from '../log';
import { toResult, type SessionService } from '../session/sessionService';

const OFFLINE_RETRY_MS = 15_000;
const MAX_TIMER_MS = 2 ** 31 - 1;

export interface LockdownGate {
  isActive(): boolean;
  onInactive(callback: () => void): () => void;
}

export interface GateControllerDeps {
  config: Pick<
    DesktopConfig,
    | 'apiBaseUrl'
    | 'configError'
    | 'gateOfflinePolicy'
    | 'gateOfflineGraceSeconds'
    | 'gateRestrictedPollSeconds'
  >;
  lock: AppLock;
  api: ApiClient;
  session: SessionService;
  power: PowerPort;
  emit: (view: GateView) => void;
  log: Logger;
  now?: () => number;
  /** After the window was unlocked / re-locked (tray, reminders). */
  onReleased?: () => void;
  onRelocked?: () => void;
}

function failure(code: 'GATE_LOCKED' | 'NOT_SIGNED_IN', message: string): Result<never> {
  return { ok: false, error: { code, message } };
}

export class GateController {
  private phase: GatePhase = 'boot';
  private status: GateStatusDTO | null = null;
  private feedback: GateView['feedback'] = null;
  private autoContinue = false;
  private admin = false;
  private releasedOffline = false;
  private clearedUntilMs: number | null = null;
  private offlineSince: number | null = null;
  private graceElapsed = false;
  private pendingRelock = false;
  private restoring = false;
  private checkSeq = 0;

  private relockTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private offlineRetryTimer: ReturnType<typeof setInterval> | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private lockdown: LockdownGate | null = null;
  private readonly disposers: (() => void)[] = [];
  private readonly now: () => number;

  constructor(private readonly deps: GateControllerDeps) {
    this.now = deps.now ?? Date.now;
    this.disposers.push(
      deps.session.onChange((change) => {
        this.onSessionChange(change);
      }),
      deps.power.on('unlock-screen', () => {
        this.onWake();
      }),
      deps.power.on('resume', () => {
        this.onWake();
      }),
      deps.power.on('shutdown', () => {
        deps.lock.markSessionEnding();
      }),
    );
  }

  attachLockdown(lockdown: LockdownGate): void {
    this.lockdown = lockdown;
    this.disposers.push(
      lockdown.onInactive(() => {
        if (this.pendingRelock) {
          this.pendingRelock = false;
          this.relock('deferred');
        }
      }),
    );
  }

  isReleased(): boolean {
    return this.phase === 'released';
  }

  getView(): GateView {
    const s = this.status;
    return {
      phase: this.phase,
      autoContinue: this.autoContinue,
      admin: this.admin,
      maxAttempts: s?.maxAttempts ?? 0,
      attemptsRemaining: s?.attemptsRemaining ?? 0,
      challenge: s?.challenge
        ? {
            challengeId: s.challenge.challengeId,
            prompt: s.challenge.prompt,
            options: [...s.challenge.options],
          }
        : null,
      clearedUntil: s?.clearedUntil ?? null,
      restricted: s?.restricted ? { ...s.restricted } : null,
      offline:
        this.phase === 'offline' && this.offlineSince !== null
          ? {
              since: new Date(this.offlineSince).toISOString(),
              graceElapsed: this.graceElapsed,
              canContinueOffline:
                this.graceElapsed && this.deps.config.gateOfflinePolicy === 'open_after_grace',
            }
          : null,
      feedback: this.feedback,
      releasedOffline: this.releasedOffline,
    };
  }

  /** Called once the window exists. Locks first, then resolves the session. */
  async start(): Promise<void> {
    const { config, lock, log } = this.deps;
    lock.lock('gate');
    if (config.configError !== null || config.apiBaseUrl === null) {
      // Covered but unable to reach any API: no network request is made (plan 4.2).
      log.error('gate.misconfigured', { reason: config.configError });
      this.setPhase('misconfigured');
      return;
    }
    this.setPhase('boot');
    await this.resolveSession();
  }

  private async resolveSession(): Promise<void> {
    this.restoring = true;
    let outcome;
    try {
      outcome = await this.deps.session.restore();
    } finally {
      this.restoring = false;
    }
    if (outcome === 'signed_in') await this.check();
    else if (outcome === 'signed_out') this.setPhase('signed_out');
    else this.goOffline();
  }

  // ---- renderer-facing operations -------------------------------------------------------------

  async requestChallenge(): Promise<Result<GateView>> {
    if (this.phase === 'misconfigured') return failure('GATE_LOCKED', 'CSense is misconfigured.');
    if (this.phase === 'released') return { ok: true, data: this.getView() };
    if (this.deps.session.getView().status === 'unknown') await this.resolveSession();
    else if (this.phase !== 'signed_out') await this.check();
    return { ok: true, data: this.getView() };
  }

  async submitAnswer(input: {
    challengeId: string;
    optionIndex: number;
  }): Promise<Result<GateAnswerView>> {
    if (this.phase !== 'challenge') return failure('GATE_LOCKED', 'No question is open.');
    const res = await this.deps.api.call(OPERATIONS['gate.attempt'], {
      body: { challengeId: input.challengeId, selectedIndex: input.optionIndex },
    });
    if (!res.ok) {
      const code = res.error.code;
      if (code === 'GATE_CHALLENGE_STALE' || code === 'ACCESS_RESTRICTED') void this.check();
      return toResult(res);
    }
    const { correct, explanation, xpEarned, status } = res.data;
    this.feedback = { correct, explanation };
    await this.applyStatus(status, { fromAnswer: true });
    return { ok: true, data: { correct, explanation, xpEarned, view: this.getView() } };
  }

  /** Release the workstation. Only valid after main itself saw a server grant. */
  continue(): Result<void> {
    if (this.phase !== 'granted') return failure('GATE_LOCKED', 'Access has not been granted.');
    this.release();
    return { ok: true, data: undefined };
  }

  continueOffline(): Result<void> {
    const view = this.getView();
    if (this.phase !== 'offline' || !view.offline?.canContinueOffline) {
      return failure('GATE_LOCKED', 'Offline access is not available.');
    }
    this.clearTimers();
    this.deps.log.warn('gate.released_offline', { since: view.offline.since });
    this.releasedOffline = true;
    this.phase = 'released';
    this.deps.lock.unlock();
    this.offlineSince = null;
    this.graceElapsed = false;
    // Re-check as soon as the API answers.
    this.offlineRetryTimer = setInterval(() => {
      void this.probe();
    }, OFFLINE_RETRY_MS);
    this.publish();
    this.deps.onReleased?.();
    return { ok: true, data: undefined };
  }

  /** Sign-out requested from the UI or tray: the controller falls back to `signed_out` via the session listener. */
  dispose(): void {
    this.clearTimers();
    for (const d of this.disposers.splice(0)) d();
  }

  // ---- state machine --------------------------------------------------------------------------

  private onSessionChange(change: 'signed_in' | 'signed_out' | 'ended'): void {
    if (change === 'signed_in') {
      // While released (offline grant) the reconnect probe decides; a fresh login always arrives locked.
      if (!this.restoring && this.phase !== 'released') void this.check();
      return;
    }
    // Signed out voluntarily, or the server ended the session.
    this.clearTimers();
    this.status = null;
    this.feedback = null;
    this.admin = false;
    if (this.phase === 'released') {
      this.relock('session_ended', { toSignedOut: true });
    } else {
      this.setPhase('signed_out');
    }
  }

  private async check(): Promise<void> {
    const seq = ++this.checkSeq;
    this.clearPoll();
    const user = this.deps.session.getUser();
    if (!user) {
      this.setPhase('signed_out');
      return;
    }
    if (this.phase !== 'offline') this.setPhase('checking');
    this.feedback = null;
    if (user.role === 'administrator') {
      this.admin = true;
      this.status = null;
      this.autoContinue = false;
      this.leaveOffline();
      this.setPhase('granted');
      return;
    }
    this.admin = false;
    const res = await this.deps.api.call(OPERATIONS['gate.status']);
    if (seq !== this.checkSeq) return;
    if (res.ok) {
      await this.applyStatus(res.data, { fromAnswer: false, seq });
      return;
    }
    this.onCheckError(res.error.code);
  }

  private onCheckError(code: string): void {
    if (code === 'NOT_SIGNED_IN') {
      this.setPhase('signed_out');
    } else if (code === 'ACCESS_RESTRICTED') {
      this.leaveOffline();
      this.status = {
        state: 'restricted',
        maxAttempts: 0,
        attemptsRemaining: 0,
        challenge: null,
        clearedUntil: null,
        restricted: { referenceId: '', since: new Date(this.now()).toISOString() },
      };
      this.setPhase('restricted');
      this.startPoll();
    } else {
      this.goOffline();
    }
  }

  private async applyStatus(
    s: GateStatusDTO,
    opts: { fromAnswer: boolean; seq?: number },
  ): Promise<void> {
    this.leaveOffline();
    if (s.state === 'required') {
      const res = await this.deps.api.call(OPERATIONS['gate.challenge']);
      if (opts.seq !== undefined && opts.seq !== this.checkSeq) return;
      if (!res.ok) {
        this.onCheckError(res.error.code);
        return;
      }
      if (res.data.state === 'required') {
        // The server owes us a question and did not give one: treat as unavailable.
        this.goOffline();
        return;
      }
      await this.applyStatus(res.data, opts);
      return;
    }
    this.status = s;
    if (s.state === 'granted') {
      this.clearedUntilMs = s.clearedUntil ? Date.parse(s.clearedUntil) : null;
      // An existing clearance auto-continues; a pass just earned does not need to.
      this.autoContinue = !opts.fromAnswer;
      this.setPhase('granted');
    } else if (s.state === 'challenge') {
      this.autoContinue = false;
      this.setPhase('challenge');
    } else {
      this.autoContinue = false;
      this.setPhase('restricted');
      this.startPoll();
    }
  }

  private release(): void {
    const { lock, log } = this.deps;
    this.clearTimers();
    this.phase = 'released';
    this.releasedOffline = false;
    lock.unlock();
    if (!this.admin && this.clearedUntilMs !== null) this.scheduleRelock(this.clearedUntilMs);
    log.info('gate.released', { admin: this.admin });
    this.publish();
    this.deps.onReleased?.();
  }

  private scheduleRelock(atMs: number): void {
    if (this.relockTimer) clearTimeout(this.relockTimer);
    const remaining = atMs - this.now();
    if (remaining <= 0) {
      this.relockTimer = setTimeout(() => {
        this.relock('clearance_expired');
      }, 0);
      return;
    }
    this.relockTimer = setTimeout(
      () => {
        if (this.clearedUntilMs !== null && this.now() < this.clearedUntilMs) {
          this.scheduleRelock(this.clearedUntilMs);
        } else {
          this.relock('clearance_expired');
        }
      },
      Math.min(remaining, MAX_TIMER_MS),
    );
  }

  private relock(reason: string, opts: { toSignedOut?: boolean } = {}): void {
    if (this.lockdown?.isActive()) {
      this.pendingRelock = true;
      return;
    }
    this.deps.log.info('gate.relock', { reason });
    this.clearTimers();
    this.releasedOffline = false;
    this.deps.lock.lock('gate');
    this.deps.onRelocked?.();
    if (opts.toSignedOut) {
      this.setPhase('signed_out');
      return;
    }
    this.setPhase('checking');
    void this.check();
  }

  private onWake(): void {
    if (this.phase === 'released') {
      if (this.releasedOffline) {
        void this.probe();
        return;
      }
      if (this.admin) return;
      if (this.clearedUntilMs === null || this.clearedUntilMs <= this.now()) {
        this.relock('wake_expired');
        return;
      }
      // Clearance still valid: confirm with the server in case access was restricted elsewhere.
      void this.deps.api.call(OPERATIONS['gate.status']).then((res) => {
        if (this.currentPhase() !== 'released') return;
        if (res.ok && res.data.state !== 'granted') this.relock('wake_not_granted');
        else if (!res.ok && res.error.code === 'ACCESS_RESTRICTED') this.relock('wake_restricted');
      });
    } else if (this.phase === 'offline') {
      void this.check();
    }
  }

  /** While released offline: relock as soon as the API answers and no clearance exists. */
  private async probe(): Promise<void> {
    if (this.currentPhase() !== 'released' || !this.releasedOffline) return;
    if (this.deps.session.getView().status !== 'signed_in') {
      const outcome = await this.deps.session.restore();
      if (outcome === 'network_error') return;
      if (outcome === 'signed_out') {
        this.relock('reconnected');
        return;
      }
      if (this.currentPhase() !== 'released') return;
    }
    const res = await this.deps.api.call(OPERATIONS['gate.status']);
    if (this.currentPhase() !== 'released') return;
    if (!res.ok) {
      if (res.error.code === 'NETWORK_UNAVAILABLE' || res.error.code === 'INTERNAL_ERROR') return;
      this.relock('reconnected');
      return;
    }
    if (res.data.state === 'granted') {
      // The server holds a valid clearance for this user: keep the workstation open.
      this.releasedOffline = false;
      this.clearedUntilMs = res.data.clearedUntil ? Date.parse(res.data.clearedUntil) : null;
      if (this.offlineRetryTimer) clearInterval(this.offlineRetryTimer);
      this.offlineRetryTimer = null;
      if (this.clearedUntilMs !== null) this.scheduleRelock(this.clearedUntilMs);
      this.publish();
      return;
    }
    this.relock('reconnected');
  }

  // ---- offline --------------------------------------------------------------------------------

  private goOffline(): void {
    const { config } = this.deps;
    if (this.phase === 'offline') return;
    this.offlineSince = this.now();
    this.graceElapsed = false;
    this.clearPoll();
    this.setPhase('offline');
    if (config.gateOfflinePolicy === 'open_after_grace') {
      this.graceTimer = setTimeout(() => {
        this.graceElapsed = true;
        this.publish();
      }, config.gateOfflineGraceSeconds * 1000);
    }
    this.offlineRetryTimer = setInterval(() => {
      void (this.deps.session.getView().status === 'unknown'
        ? this.resolveSession()
        : this.check());
    }, OFFLINE_RETRY_MS);
  }

  private leaveOffline(): void {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    if (this.phase === 'offline' && this.offlineRetryTimer) clearInterval(this.offlineRetryTimer);
    if (this.phase === 'offline') this.offlineRetryTimer = null;
    this.offlineSince = null;
    this.graceElapsed = false;
  }

  // ---- restricted poll ------------------------------------------------------------------------

  private startPoll(): void {
    this.clearPoll();
    this.pollTimer = setInterval(() => {
      void this.pollRestricted();
    }, this.deps.config.gateRestrictedPollSeconds * 1000);
  }

  private async pollRestricted(): Promise<void> {
    if (this.phase !== 'restricted') {
      this.clearPoll();
      return;
    }
    const res = await this.deps.api.call(OPERATIONS['gate.status']);
    if (this.currentPhase() !== 'restricted') return;
    if (!res.ok || res.data.state === 'restricted') return;
    this.clearPoll();
    this.feedback = null;
    await this.applyStatus(res.data, { fromAnswer: false });
  }

  // ---- plumbing -------------------------------------------------------------------------------

  /** The phase as a widened value, for re-reads after an `await` (it may have changed meanwhile). */
  private currentPhase(): GatePhase {
    return this.phase;
  }

  private setPhase(phase: GatePhase): void {
    this.phase = phase;
    if (phase !== 'challenge' && phase !== 'granted' && phase !== 'restricted') {
      if (phase === 'signed_out' || phase === 'boot') this.status = null;
    }
    this.publish();
  }

  private clearPoll(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private clearTimers(): void {
    this.clearPoll();
    for (const t of [this.relockTimer, this.graceTimer]) if (t) clearTimeout(t);
    if (this.offlineRetryTimer) clearInterval(this.offlineRetryTimer);
    this.relockTimer = null;
    this.graceTimer = null;
    this.offlineRetryTimer = null;
  }

  private publish(): void {
    this.deps.emit(this.getView());
  }
}
