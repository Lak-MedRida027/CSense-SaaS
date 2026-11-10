/**
 * AppLock (plan 4.5): the window/kiosk primitives shared by the gate and the quiz lockdown.
 *
 * `lock(profile)` and `unlock()` are the only places that change the window's lock state, so every
 * exit path funnels through one idempotent `unlock()`. All restrictions are properties of this
 * process's window, kiosk state or global shortcut, so a crash or kill removes every one of them.
 * OS logoff and shutdown are never blocked (`markSessionEnding`).
 */
import type { ClipboardPort, GlobalShortcutPort, WindowPort } from '../electron/types';
import type { Logger } from '../log';
import type { CoverManager } from './covers';
import { decideInput, type LockProfile } from './inputFilter';

export type LockState = 'unlocked' | LockProfile;

export const RELEASED_WINDOW_SIZE = { width: 1280, height: 800 } as const;
const PRINT_SCREEN = 'PrintScreen';

export interface AppLockDeps {
  window: WindowPort;
  covers: CoverManager;
  clipboard: ClipboardPort;
  globalShortcut: GlobalShortcutPort;
  log: Logger;
  /** Called for each blocked keystroke while locked (the lockdown controller throttles a warning). */
  onBlockedInput?: (profile: LockProfile) => void;
  /**
   * True only while the gate shows the Login step (D5-1: paste into the Login inputs). Consulted for
   * the gate profile only; if absent, or it returns false or throws, paste stays blocked.
   */
  allowPaste?: () => boolean;
  /** When unlocked, closing the window hides it to the tray instead of quitting (D5-22). */
  canHideToTray?: () => boolean;
}

export class AppLock {
  private current: LockState = 'unlocked';
  private sessionEnding = false;
  private printScreenRegistered = false;
  private readonly disposers: (() => void)[] = [];

  constructor(private readonly deps: AppLockDeps) {
    const { window } = deps;
    this.disposers.push(
      window.onBeforeInput((input) => {
        if (this.current === 'unlocked') return false;
        let allowPaste = false;
        if (this.current === 'gate') {
          try {
            allowPaste = deps.allowPaste?.() === true;
          } catch {
            allowPaste = false;
          }
        }
        const decision = decideInput(this.current, input, { allowPaste });
        if (!decision.allow && input.type === 'keyDown') deps.onBlockedInput?.(this.current);
        return !decision.allow;
      }),
      window.onClose(() => {
        if (this.sessionEnding) return false;
        if (this.current !== 'unlocked') return true;
        if (deps.canHideToTray?.()) {
          window.hide();
          return true;
        }
        return false;
      }),
      window.onSessionEnd(() => {
        this.markSessionEnding();
      }),
    );
  }

  get state(): LockState {
    return this.current;
  }

  get isLocked(): boolean {
    return this.current !== 'unlocked';
  }

  get isSessionEnding(): boolean {
    return this.sessionEnding;
  }

  /** `before-quit` is refused while locked, except during OS logoff or shutdown. */
  canQuit(): boolean {
    return this.sessionEnding || this.current === 'unlocked';
  }

  markSessionEnding(): void {
    this.sessionEnding = true;
    this.deps.log.info('lock.session_ending');
  }

  lock(profile: LockProfile): void {
    const { window, covers, clipboard, log } = this.deps;
    if (window.isDestroyed()) return;
    const previous = this.current;
    this.current = profile;

    window.show();
    window.setSkipTaskbar(true);
    window.setClosable(false);
    window.setMinimizable(false);
    window.setMovable(false);
    window.setFullScreen(true);
    window.setKiosk(true);
    window.setAlwaysOnTop(true, 'screen-saver');
    window.closeDevTools();
    covers.enable();

    if (profile === 'lockdown') {
      // Screenshots and screen recording of this window capture black (WDA_EXCLUDEFROMCAPTURE).
      window.setContentProtection(true);
      clipboard.clear();
      this.registerPrintScreen();
    } else if (previous === 'lockdown') {
      this.undoLockdownExtras();
    }
    window.focus();
    log.info('lock.locked', { profile });
  }

  /** Idempotent: every exit path calls this. */
  unlock(): void {
    const { window, covers, log } = this.deps;
    if (this.current === 'unlocked') return;
    const wasLockdown = this.current === 'lockdown';
    this.current = 'unlocked';
    if (wasLockdown) this.undoLockdownExtras();
    covers.disable();
    if (window.isDestroyed()) return;
    window.setAlwaysOnTop(false);
    window.setKiosk(false);
    window.setFullScreen(false);
    window.setClosable(true);
    window.setMinimizable(true);
    window.setMovable(true);
    window.setSkipTaskbar(false);
    window.setSize(RELEASED_WINDOW_SIZE.width, RELEASED_WINDOW_SIZE.height);
    window.center();
    window.focus();
    log.info('lock.unlocked');
  }

  dispose(): void {
    for (const d of this.disposers.splice(0)) d();
    this.unlock();
  }

  private undoLockdownExtras(): void {
    const { window, clipboard } = this.deps;
    if (!window.isDestroyed()) window.setContentProtection(false);
    clipboard.clear();
    this.unregisterPrintScreen();
  }

  private registerPrintScreen(): void {
    if (this.printScreenRegistered) return;
    try {
      // Best effort: the OS or another app may already own this key.
      this.printScreenRegistered = this.deps.globalShortcut.register(PRINT_SCREEN, () => undefined);
    } catch {
      this.printScreenRegistered = false;
    }
  }

  private unregisterPrintScreen(): void {
    if (!this.printScreenRegistered) return;
    this.printScreenRegistered = false;
    try {
      this.deps.globalShortcut.unregister(PRINT_SCREEN);
    } catch {
      // Nothing to release.
    }
  }
}
