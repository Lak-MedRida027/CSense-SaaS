/**
 * LockdownController (plan 7, ADR 0016): quiz kiosk lockdown, coupled to a server session.
 *
 * - Lockdown is entered only by `startSecure`: main locks the window, starts the session itself and
 *   only then returns the questions (S17). There is no free-standing "enter lockdown".
 * - `submit`, `exit` and `resume` must name the active session id; a renderer-supplied id is never trusted.
 * - Always exitable: `exit` unlocks locally and synchronously BEFORE any network call, focus-loss and
 *   crash policies end the attempt, and a hard cap applies at `expiresAt + 60 s`.
 */
import type { AttemptResultDTO, AssessmentSessionDTO } from '../../shared/dto';
import type {
  LockdownEndReason,
  LockdownStateName,
  MainEvent,
  Result,
  SecureSessionView,
  SecureStartInput,
} from '../../shared/ipcChannels';
import type { ApiClient } from '../api/client';
import { OPERATIONS } from '../api/operations';
import type { DesktopConfig } from '../config';
import type { FsPort, WindowPort } from '../electron/types';
import type { LockdownGate } from '../gate/gateController';
import type { AppLock } from '../lock/appLock';
import type { Logger } from '../log';
import { toResult } from '../session/sessionService';

export const FOCUS_DEBOUNCE_MS = 500;
export const HANG_LIMIT_MS = 10_000;
export const HARD_CAP_GRACE_MS = 60_000;
export const BLOCKED_NOTICE_THROTTLE_MS = 2000;
const ABANDON_BACKOFF_MS = [1000, 2000, 4000] as const;
const EXIT_RESULT_WAIT_MS = 5000;

interface ActiveLockdown {
  sessionId: string;
  kind: 'quiz' | 'final';
  moduleId: string | null;
  expiresAt: number;
  session: AssessmentSessionDTO;
  focusLosses: number;
  crashed: boolean;
}

export interface PendingAbandon {
  kind: 'quiz' | 'final';
  moduleId: string | null;
  sessionId: string;
}

export interface LockdownDeps {
  config: Pick<DesktopConfig, 'lockdownMaxFocusLosses' | 'lockdownFocusAwaySeconds'>;
  lock: AppLock;
  window: WindowPort;
  api: ApiClient;
  fs: FsPort;
  /** Absolute path of pending.json (ids only). */
  pendingPath: string;
  emit: (event: MainEvent) => void;
  log: Logger;
  gate: { isReleased(): boolean };
  now?: () => number;
}

const TERMINAL_SUBMIT_CODES = new Set(['SESSION_CLOSED', 'SESSION_EXPIRED', 'ASSESSMENT_COOLDOWN']);

export class LockdownController implements LockdownGate {
  private state: LockdownStateName = 'inactive';
  private active: ActiveLockdown | null = null;
  private blockedCount = 0;
  private lastBlockedNoticeAt = 0;
  private focusDebounce: ReturnType<typeof setTimeout> | null = null;
  private focusAway: ReturnType<typeof setTimeout> | null = null;
  private hangTimer: ReturnType<typeof setTimeout> | null = null;
  private hardCap: ReturnType<typeof setTimeout> | null = null;
  private pending: PendingAbandon[] = [];
  private readonly inactiveListeners = new Set<() => void>();
  private readonly disposers: (() => void)[] = [];
  private readonly now: () => number;

  constructor(private readonly deps: LockdownDeps) {
    this.now = deps.now ?? Date.now;
    const { window } = deps;
    this.disposers.push(
      window.onBlur(() => {
        this.onBlur();
      }),
      window.onFocus(() => {
        this.clearFocusTimers();
      }),
      window.onDevToolsOpened(() => {
        this.onDevTools();
      }),
      window.onRenderProcessGone((d) => {
        this.onRendererGone(d.reason);
      }),
      window.onUnresponsive(() => {
        this.onUnresponsive();
      }),
      window.onResponsive(() => {
        this.clearHang();
      }),
    );
  }

  // ---- LockdownGate (used by the gate controller) ---------------------------------------------

  isActive(): boolean {
    return this.state === 'entering' || this.state === 'active' || this.state === 'exiting';
  }

  onInactive(callback: () => void): () => void {
    this.inactiveListeners.add(callback);
    return () => {
      this.inactiveListeners.delete(callback);
    };
  }

  getState(): LockdownStateName {
    return this.state;
  }

  // ---- bridge operations ----------------------------------------------------------------------

  async startSecure(input: SecureStartInput): Promise<Result<SecureSessionView>> {
    const { lock, api, config } = this.deps;
    if (this.state !== 'inactive') {
      return {
        ok: false,
        error: { code: 'CONFLICT', message: 'A secure session is already running.' },
      };
    }
    if (!this.deps.gate.isReleased()) {
      return {
        ok: false,
        error: { code: 'GATE_LOCKED', message: 'Complete the security check first.' },
      };
    }
    this.setState('entering', null);
    lock.lock('lockdown');
    const res =
      input.kind === 'quiz'
        ? await api.call(OPERATIONS['quiz.startSession'], { params: { moduleId: input.moduleId } })
        : await api.call(OPERATIONS['final.startSession']);
    if (!res.ok) {
      lock.unlock();
      this.setState('failed', null);
      this.setState('inactive', null, 'start_failed');
      return toResult(res);
    }
    const session = res.data;
    const expiresAt = Date.parse(session.expiresAt);
    this.active = {
      sessionId: session.sessionId,
      kind: input.kind,
      moduleId: input.kind === 'quiz' ? input.moduleId : null,
      expiresAt: Number.isNaN(expiresAt) ? this.now() + 60 * 60_000 : expiresAt,
      session,
      focusLosses: 0,
      crashed: false,
    };
    this.blockedCount = 0;
    this.armHardCap();
    api.armProactiveRefresh(true);
    this.setState('active', session.sessionId);
    this.deps.log.info('lockdown.entered', { sessionId: session.sessionId });
    return {
      ok: true,
      data: { session, resumed: false, remainingFocusLosses: config.lockdownMaxFocusLosses },
    };
  }

  /** After a renderer reload: the cached session (questions, no keys), or null. */
  resume(): SecureSessionView | null {
    const a = this.active;
    if (this.state !== 'active' || !a) return null;
    return {
      session: a.session,
      resumed: a.crashed,
      remainingFocusLosses: Math.max(0, this.deps.config.lockdownMaxFocusLosses - a.focusLosses),
    };
  }

  async submit(input: {
    sessionId: string;
    answers: { questionId: string; selectedIndex: number | null }[];
  }): Promise<Result<AttemptResultDTO>> {
    const a = this.requireActive(input.sessionId);
    if (!a) return notActive();
    const { api } = this.deps;
    const body = { sessionId: a.sessionId, answers: input.answers };
    const res =
      a.kind === 'quiz' && a.moduleId
        ? await api.call(OPERATIONS['quiz.submit'], { params: { moduleId: a.moduleId }, body })
        : await api.call(OPERATIONS['final.submit'], { body });
    if (res.ok) {
      this.exitLocal('submitted');
      return { ok: true, data: res.data };
    }
    const code = res.error.code;
    if (TERMINAL_SUBMIT_CODES.has(code)) {
      this.exitLocal(code === 'ASSESSMENT_COOLDOWN' ? 'submitted' : 'session_expired');
    } else if (code === 'NOT_SIGNED_IN') {
      // The session ended mid-quiz: leave lockdown; the abandon cannot be sent (no credentials).
      this.exitLocal('session_expired');
    }
    // Network and other errors: stay in lockdown so the renderer can retry or exit.
    return toResult(res);
  }

  async exit(input: { sessionId: string }): Promise<Result<{ attempt: AttemptResultDTO | null }>> {
    const a = this.requireActive(input.sessionId);
    if (!a) return notActive();
    // Local unlock first, synchronously, with no network dependency (WCAG 2.1.2, S20).
    this.exitLocal('user_exit');
    const attempt = await Promise.race([
      this.abandonFlow(a),
      new Promise<null>((resolve) =>
        setTimeout(() => {
          resolve(null);
        }, EXIT_RESULT_WAIT_MS),
      ),
    ]);
    return { ok: true, data: { attempt } };
  }

  /** Sign-out path: leave lockdown locally (if active) and abandon in the background. */
  leaveForSignOut(): void {
    const a = this.active;
    if (this.state !== 'active' || !a) return;
    this.exitLocal('user_exit');
    void this.abandonFlow(a);
  }

  /** Called by AppLock for each blocked key while locked; surfaces a throttled notice. */
  noteBlockedInput(): void {
    const a = this.active;
    if (this.state !== 'active' || !a) return;
    const t = this.now();
    if (t - this.lastBlockedNoticeAt < BLOCKED_NOTICE_THROTTLE_MS) return;
    this.lastBlockedNoticeAt = t;
    this.blockedCount++;
    this.deps.emit({
      type: 'lockdown-violation',
      kind: 'blocked_shortcut',
      count: this.blockedCount,
      remaining: this.remainingFocusLosses(a),
    });
  }

  // ---- pending abandons -----------------------------------------------------------------------

  async loadPending(): Promise<void> {
    try {
      const raw = await this.deps.fs.readFile(this.deps.pendingPath);
      if (!raw) return;
      const parsed = JSON.parse(raw.toString('utf8')) as unknown;
      if (Array.isArray(parsed)) {
        this.pending = parsed.filter(isPendingAbandon).slice(0, 20);
      }
    } catch {
      this.pending = [];
    }
  }

  getPending(): readonly PendingAbandon[] {
    return this.pending;
  }

  /** Retry abandons that never reached the server (called once signed in and online). */
  async retryPending(): Promise<void> {
    for (const p of [...this.pending]) {
      const res = await this.sendAbandon(p);
      if (res.kind === 'done') await this.removePending(p.sessionId);
      else if (res.kind === 'retry') return;
    }
  }

  dispose(): void {
    this.clearFocusTimers();
    this.clearHang();
    if (this.hardCap) clearTimeout(this.hardCap);
    this.hardCap = null;
    for (const d of this.disposers.splice(0)) d();
  }

  // ---- policies -------------------------------------------------------------------------------

  private onBlur(): void {
    if (this.state !== 'active') return;
    const { config } = this.deps;
    this.clearFocusTimers();
    this.focusDebounce = setTimeout(() => {
      this.focusDebounce = null;
      this.onFocusLost();
    }, FOCUS_DEBOUNCE_MS);
    this.focusAway = setTimeout(() => {
      this.focusAway = null;
      this.autoAbandon('focus_lost');
    }, config.lockdownFocusAwaySeconds * 1000);
  }

  private onFocusLost(): void {
    const a = this.active;
    if (this.state !== 'active' || !a) return;
    const { window, config } = this.deps;
    a.focusLosses++;
    window.moveTop();
    window.focus();
    window.flashFrame(true);
    const remaining = this.remainingFocusLosses(a);
    this.deps.emit({
      type: 'lockdown-violation',
      kind: 'focus_lost',
      count: a.focusLosses,
      remaining,
    });
    this.deps.log.warn('lockdown.focus_lost', { count: a.focusLosses });
    if (a.focusLosses >= config.lockdownMaxFocusLosses) this.autoAbandon('focus_lost');
  }

  private onDevTools(): void {
    const a = this.active;
    if (this.state !== 'active' || !a) return;
    this.deps.window.closeDevTools();
    this.blockedCount++;
    this.deps.emit({
      type: 'lockdown-violation',
      kind: 'devtools',
      count: this.blockedCount,
      remaining: this.remainingFocusLosses(a),
    });
    this.deps.log.warn('lockdown.devtools_opened');
  }

  private onRendererGone(reason: string): void {
    const a = this.active;
    if (this.state !== 'active' || !a || reason === 'clean-exit') return;
    this.clearHang();
    this.deps.log.warn('lockdown.renderer_gone', { reason, second: a.crashed });
    if (!a.crashed) {
      // First crash: stay locked, reload; the renderer resumes from main's cached session.
      a.crashed = true;
      this.deps.window.reload();
    } else {
      this.autoAbandon('crash');
      this.deps.window.reload();
    }
  }

  private onUnresponsive(): void {
    if (this.state !== 'active') return;
    this.clearHang();
    this.hangTimer = setTimeout(() => {
      this.hangTimer = null;
      if (this.state === 'active') this.deps.window.forcefullyCrashRenderer();
    }, HANG_LIMIT_MS);
  }

  private armHardCap(): void {
    if (this.hardCap) clearTimeout(this.hardCap);
    const a = this.active;
    if (!a) return;
    const delay = Math.max(a.expiresAt + HARD_CAP_GRACE_MS - this.now(), 0);
    this.hardCap = setTimeout(
      () => {
        this.hardCap = null;
        this.autoAbandon('hard_cap');
      },
      Math.min(delay, 2 ** 31 - 1),
    );
  }

  // ---- exit paths -----------------------------------------------------------------------------

  private autoAbandon(reason: LockdownEndReason): void {
    const a = this.active;
    if (this.state !== 'active' || !a) return;
    this.deps.log.warn('lockdown.auto_abandon', { reason });
    this.exitLocal(reason);
    void this.abandonFlow(a);
  }

  /** Synchronous local exit. Idempotent: every path calls it. */
  private exitLocal(reason: LockdownEndReason): void {
    if (this.state === 'inactive') return;
    const sessionId = this.active?.sessionId ?? null;
    this.setState('exiting', sessionId);
    this.clearFocusTimers();
    this.clearHang();
    if (this.hardCap) clearTimeout(this.hardCap);
    this.hardCap = null;
    this.active = null;
    this.deps.api.armProactiveRefresh(false);
    this.deps.lock.unlock();
    this.deps.window.flashFrame(false);
    this.setState('inactive', sessionId, reason);
    this.deps.log.info('lockdown.exited', { reason });
  }

  private async abandonFlow(a: ActiveLockdown): Promise<AttemptResultDTO | null> {
    const p: PendingAbandon = { kind: a.kind, moduleId: a.moduleId, sessionId: a.sessionId };
    await this.addPending(p);
    for (let i = 0; i <= ABANDON_BACKOFF_MS.length; i++) {
      const res = await this.sendAbandon(p);
      if (res.kind === 'done') {
        await this.removePending(p.sessionId);
        return res.result;
      }
      if (res.kind === 'stop') return null;
      const wait = ABANDON_BACKOFF_MS[i];
      if (wait === undefined) break;
      await new Promise<void>((resolve) => setTimeout(resolve, wait));
    }
    return null;
  }

  /** 'done': server closed the session (or it was already closed). 'retry': try later. 'stop': cannot send. */
  private async sendAbandon(
    p: PendingAbandon,
  ): Promise<{ kind: 'done'; result: AttemptResultDTO | null } | { kind: 'retry' | 'stop' }> {
    const { api } = this.deps;
    const res =
      p.kind === 'quiz' && p.moduleId
        ? await api.call(OPERATIONS['quiz.abandon'], {
            params: { moduleId: p.moduleId, sessionId: p.sessionId },
          })
        : await api.call(OPERATIONS['final.abandon'], { params: { sessionId: p.sessionId } });
    if (res.ok) return { kind: 'done', result: res.data };
    const code = res.error.code;
    // The session is already closed, expired or gone: nothing left to abandon.
    if (code === 'SESSION_CLOSED' || code === 'NOT_FOUND' || code === 'SESSION_EXPIRED') {
      return { kind: 'done', result: null };
    }
    if (code === 'NOT_SIGNED_IN') return { kind: 'stop' };
    return { kind: 'retry' };
  }

  private async addPending(p: PendingAbandon): Promise<void> {
    if (!this.pending.some((x) => x.sessionId === p.sessionId)) this.pending.push(p);
    await this.persistPending();
  }

  private async removePending(sessionId: string): Promise<void> {
    this.pending = this.pending.filter((x) => x.sessionId !== sessionId);
    await this.persistPending();
  }

  private async persistPending(): Promise<void> {
    const { fs, pendingPath, log } = this.deps;
    try {
      if (this.pending.length === 0) {
        await fs.unlink(pendingPath);
        return;
      }
      const dir = pendingPath.slice(
        0,
        Math.max(pendingPath.lastIndexOf('/'), pendingPath.lastIndexOf('\\')),
      );
      if (dir) await fs.mkdir(dir);
      await fs.writeFile(pendingPath, JSON.stringify(this.pending));
    } catch {
      log.warn('lockdown.pending_persist_failed');
    }
  }

  // ---- helpers --------------------------------------------------------------------------------

  private requireActive(sessionId: string): ActiveLockdown | null {
    const a = this.active;
    return this.state === 'active' && a && a.sessionId === sessionId ? a : null;
  }

  private remainingFocusLosses(a: ActiveLockdown): number {
    return Math.max(0, this.deps.config.lockdownMaxFocusLosses - a.focusLosses);
  }

  private clearFocusTimers(): void {
    if (this.focusDebounce) clearTimeout(this.focusDebounce);
    if (this.focusAway) clearTimeout(this.focusAway);
    this.focusDebounce = null;
    this.focusAway = null;
  }

  private clearHang(): void {
    if (this.hangTimer) clearTimeout(this.hangTimer);
    this.hangTimer = null;
  }

  private setState(
    state: LockdownStateName,
    sessionId: string | null,
    reason?: LockdownEndReason,
  ): void {
    this.state = state;
    this.deps.emit({
      type: 'lockdown',
      state,
      sessionId,
      ...(reason !== undefined ? { reason } : {}),
    });
    if (state === 'inactive') for (const l of [...this.inactiveListeners]) l();
  }
}

function notActive(): Result<never> {
  return {
    ok: false,
    error: { code: 'LOCKDOWN_NOT_ACTIVE', message: 'No matching secure session is active.' },
  };
}

function isPendingAbandon(x: unknown): x is PendingAbandon {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    (o.kind === 'quiz' || o.kind === 'final') &&
    typeof o.sessionId === 'string' &&
    /^[a-f0-9]{24}$/i.test(o.sessionId) &&
    (o.moduleId === null || (typeof o.moduleId === 'string' && /^[a-f0-9]{24}$/i.test(o.moduleId)))
  );
}
