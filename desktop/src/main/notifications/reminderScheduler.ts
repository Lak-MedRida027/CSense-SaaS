/**
 * Training reminders as native OS notifications (plan 8, D5-21). Computed in main from `GET /modules`
 * after release. Generic, non-sensitive text only: no scores, no risk, no question text.
 *
 * Never shown during the gate or a lockdown, never while the CSense window is focused, at most
 * `maxPerDay` per day. State (`lastShownAt` per kind, a count per day) is persisted without titles.
 */
import type { MainEvent } from '../../shared/ipcChannels';
import type { ApiClient } from '../api/client';
import { OPERATIONS } from '../api/operations';
import type { DesktopConfig } from '../config';
import type { FsPort, NotificationPort } from '../electron/types';
import type { Logger } from '../log';

export type ReminderKind = 'continue' | 'quiz_again' | 'final_unlocked';

interface ReminderState {
  day: string;
  countToday: number;
  lastShownAt: Partial<Record<ReminderKind, number>>;
  finalWasLocked: boolean;
}

export const LEARNING_IDLE_MS = 2 * 60 * 60 * 1000;

export interface ReminderDeps {
  config: Pick<DesktopConfig, 'reminders'>;
  api: ApiClient;
  notification: NotificationPort;
  fs: FsPort;
  /** Absolute path of reminders.json. */
  statePath: string;
  /** Gate locked or lockdown active. */
  isSuppressed: () => boolean;
  isSignedIn: () => boolean;
  isWindowFocused: () => boolean;
  showWindow: () => void;
  emit: (event: MainEvent) => void;
  log: Logger;
  now?: () => number;
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export class ReminderScheduler {
  private state: ReminderState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  private lastLearningActivity = 0;
  private running = false;
  private readonly now: () => number;

  constructor(private readonly deps: ReminderDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Begin (or restart) the cycle after a release: first check after the first delay. */
  start(): void {
    this.stop();
    this.running = true;
    this.lastLearningActivity = this.now();
    this.schedule(this.deps.config.reminders.firstDelayMinutes);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    this.timer = null;
    this.cooldownTimer = null;
  }

  /** A learning call went through the app: the "no activity for 2 hours" clock restarts. */
  noteLearningActivity(): void {
    this.lastLearningActivity = this.now();
  }

  /** A quiz or the final test is on cooldown until `iso`: remind once when it ends. */
  noteCooldown(iso: string): void {
    const at = Date.parse(iso);
    if (Number.isNaN(at) || at <= this.now()) return;
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    this.cooldownTimer = setTimeout(
      () => {
        this.cooldownTimer = null;
        void this.deliver('quiz_again');
      },
      Math.min(at - this.now(), 2 ** 31 - 1),
    );
  }

  /** One check. Exposed for tests; normally driven by the timer. */
  async tick(): Promise<void> {
    if (!this.canShowNow()) return;
    const res = await this.deps.api.call(OPERATIONS['modules.list']);
    if (!res.ok) return;
    const overview = res.data;
    const state = await this.loadState();

    const finalStatus = overview.finalTest?.status;
    const finalLocked = finalStatus === 'locked';
    const finalOpen = finalStatus === 'unlocked' || finalStatus === 'in_progress';
    const finalJustUnlocked = state.finalWasLocked && finalOpen;
    if (finalStatus !== undefined && state.finalWasLocked !== finalLocked) {
      state.finalWasLocked = finalLocked;
      await this.saveState(state);
    }
    if (finalJustUnlocked) {
      await this.deliver('final_unlocked');
      return;
    }

    const next = overview.modules.find((m) => m.id === overview.nextModuleId);
    const idle = this.now() - this.lastLearningActivity >= LEARNING_IDLE_MS;
    if (next && next.status !== 'locked' && next.status !== 'completed' && idle) {
      await this.deliver('continue', next.position);
    }
  }

  private schedule(minutes: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      void this.tick()
        .catch(() => undefined)
        .finally(() => {
          this.schedule(this.deps.config.reminders.intervalMinutes);
        });
    }, minutes * 60_000);
  }

  private canShowNow(): boolean {
    const { notification, isSuppressed, isSignedIn, isWindowFocused } = this.deps;
    if (!notification.isSupported()) return false;
    if (isSuppressed() || !isSignedIn()) return false;
    return !isWindowFocused();
  }

  private async deliver(kind: ReminderKind, moduleNumber?: number): Promise<void> {
    if (!this.canShowNow()) return;
    const state = await this.loadState();
    if (state.countToday >= this.deps.config.reminders.maxPerDay) return;
    const { title, body } = this.copy(kind, moduleNumber);
    state.countToday++;
    state.lastShownAt[kind] = this.now();
    await this.saveState(state);
    this.deps.notification.show({ title, body }, () => {
      // Ignored while locked: the window is covered by the gate and cannot be navigated.
      if (this.deps.isSuppressed()) return;
      this.deps.showWindow();
      this.deps.emit({ type: 'navigate', to: 'home' });
    });
  }

  private copy(kind: ReminderKind, moduleNumber?: number): { title: string; body: string } {
    if (kind === 'continue') {
      return {
        title: 'CSense',
        body:
          moduleNumber !== undefined
            ? `Training reminder: continue Module ${String(moduleNumber)}.`
            : 'Training reminder: continue your training.',
      };
    }
    if (kind === 'quiz_again') return { title: 'CSense', body: 'You can retry the quiz now.' };
    return { title: 'CSense', body: 'The final assessment is now available.' };
  }

  private async loadState(): Promise<ReminderState> {
    const today = dayKey(this.now());
    if (!this.state) {
      let loaded: Partial<ReminderState> = {};
      try {
        const raw = await this.deps.fs.readFile(this.deps.statePath);
        if (raw) loaded = JSON.parse(raw.toString('utf8')) as Partial<ReminderState>;
      } catch {
        loaded = {};
      }
      this.state = {
        day: typeof loaded.day === 'string' ? loaded.day : today,
        countToday: typeof loaded.countToday === 'number' ? loaded.countToday : 0,
        lastShownAt: typeof loaded.lastShownAt === 'object' ? loaded.lastShownAt : {},
        finalWasLocked: loaded.finalWasLocked === true,
      };
    }
    if (this.state.day !== today) {
      this.state.day = today;
      this.state.countToday = 0;
    }
    return this.state;
  }

  private async saveState(state: ReminderState): Promise<void> {
    const { fs, statePath, log } = this.deps;
    try {
      const dir = statePath.slice(
        0,
        Math.max(statePath.lastIndexOf('/'), statePath.lastIndexOf('\\')),
      );
      if (dir) await fs.mkdir(dir);
      await fs.writeFile(statePath, JSON.stringify(state));
    } catch {
      log.warn('reminders.persist_failed');
    }
  }
}
