/**
 * App lifecycle and composition root (plan 4, 6): single instance, auto-start, AUMID, the app://
 * protocol, the command-line guard, window creation, and wiring of every controller.
 *
 * Order matters for the gate: the window is locked and covered BEFORE any network call is made.
 */
import { join } from 'node:path';
import { BrowserWindow, Menu, app, ipcMain, session } from 'electron';
import {
  IPC_CHANNEL_NAMES,
  IPC_EVENT_CHANNEL,
  type GateView,
  type MainEvent,
  type SessionView,
} from '../shared/ipcChannels';
import { ApiClient } from './api/client';
import { loadDesktopConfig } from './config';
import {
  createApiFetch,
  createDisplaysPort,
  createSafeStoragePort,
  createWindowPort,
  realClipboard,
  realFs,
  realGlobalShortcut,
  realNotification,
  realPower,
} from './electron/ports';
import { GateController } from './gate/gateController';
import { GateStateStore } from './gate/gateStateStore';
import { OfflineReporter } from './gate/offlineReporter';
import { buildHandlers } from './ipc/handlers';
import { IpcRegistry } from './ipc/registry';
import { AppLock } from './lock/appLock';
import { CoverManager } from './lock/covers';
import { createFileLogger } from './log';
import { LockdownController } from './lockdown/lockdownController';
import { ReminderScheduler } from './notifications/reminderScheduler';
import {
  denyCertificateErrors,
  hardenUiSession,
  hardenWebContents,
  mainWindowOptions,
} from './security/hardening';
import { APP_ORIGIN, forbiddenCommandLineFlags, isAllowedSender } from './security/policy';
import { handleAppProtocol, registerAppScheme } from './security/protocol';
import { SessionService } from './session/sessionService';
import { TokenStore } from './session/tokenStore';
import { createTray, type TrayHandle } from './tray';

export function bootstrap(): void {
  const isPackaged = app.isPackaged;

  // Debugging switches abort a packaged start (S2). Checked before anything else.
  if (isPackaged) {
    const bad = forbiddenCommandLineFlags(process.argv);
    if (bad.length > 0) {
      process.stderr.write('CSense refused to start: debugging switches are not allowed.\n');
      app.exit(2);
      return;
    }
  }

  const build = Object.fromEntries(
    Object.entries(import.meta.env).filter(([k]) => k.startsWith('MAIN_VITE_')),
  );
  const config = loadDesktopConfig({ build, env: process.env }, { isPackaged });
  // e2e isolation (unpackaged only: `config` ignores the variable when packaged).
  if (config.userDataDir) app.setPath('userData', config.userDataDir);

  registerAppScheme();

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  const devUrl = !isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
  const devOrigin = devUrl ? new URL(devUrl).origin : null;
  const devToolsAllowed = !isPackaged && config.devToolsInDev;

  void app.whenReady().then(() => {
    app.setAppUserModelId('com.csense.desktop');
    const userData = app.getPath('userData');
    const log = createFileLogger({ fs: realFs, dir: join(userData, 'logs') });
    const hardening = {
      devOrigin,
      devToolsAllowed,
      externalLinkHosts: config.externalLinkHosts,
      log,
    };

    denyCertificateErrors(log);
    handleAppProtocol(join(__dirname, '../renderer'));
    hardenUiSession(session.defaultSession, hardening);
    app.on('web-contents-created', (_e, contents) => {
      hardenWebContents(contents, hardening);
    });

    // Only the zoom accelerators survive (WCAG 1.4.4); no reload, devtools or navigation shortcuts.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: 'View',
          submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }],
        },
      ]),
    );

    const win = new BrowserWindow(mainWindowOptions({ devToolsAllowed }));
    const windowPort = createWindowPort(win);
    const emit = (event: MainEvent): void => {
      windowPort.send(IPC_EVENT_CHANNEL, event);
    };

    // ---- composition --------------------------------------------------------------------------
    const safeStorage = createSafeStoragePort();
    const tokens = new TokenStore({
      fs: realFs,
      safeStorage,
      filePath: join(userData, 'session.v1.json'),
      log,
    });

    // Controllers reference each other; these late-bound slots break the construction cycle.
    const late: {
      session?: SessionService;
      lockdown?: LockdownController;
      gate?: GateController;
      tray?: TrayHandle;
    } = {};
    const api = new ApiClient({
      baseUrl: config.apiBaseUrl ?? '',
      fetch: createApiFetch(),
      tokens,
      log,
      onSessionEnded: (reason) => {
        late.session?.handleEnded(reason);
      },
    });
    const sessionSvc = new SessionService({
      api,
      tokens,
      log,
      emit: (view: SessionView) => {
        emit({ type: 'session', view });
      },
    });
    late.session = sessionSvc;
    let quitting = false;
    const lock = new AppLock({
      window: windowPort,
      covers: new CoverManager(createDisplaysPort(win)),
      clipboard: realClipboard,
      globalShortcut: realGlobalShortcut,
      log,
      onBlockedInput: (profile) => {
        if (profile === 'lockdown') late.lockdown?.noteBlockedInput();
      },
      // Paste is allowed only on the Login step, decided from main's own gate state.
      allowPaste: () => late.gate?.getView().phase === 'signed_out',
      canHideToTray: () => !quitting && late.tray !== undefined,
    });

    const reminders = new ReminderScheduler({
      config,
      api,
      notification: realNotification,
      fs: realFs,
      statePath: join(userData, 'reminders.json'),
      isSuppressed: () => lock.isLocked,
      isSignedIn: () => sessionSvc.getView().status === 'signed_in',
      isWindowFocused: () => win.isFocused() && win.isVisible(),
      showWindow: () => {
        win.show();
        win.focus();
      },
      emit,
      log,
    });

    const gateState = new GateStateStore({
      fs: realFs,
      safeStorage,
      filePath: join(userData, 'gate-state.v1.json'),
      log,
    });
    const offlineReports = new OfflineReporter({
      api,
      fs: realFs,
      safeStorage,
      filePath: join(userData, 'offline-releases.v1.json'),
      log,
    });
    const gate = new GateController({
      config,
      lock,
      api,
      session: sessionSvc,
      power: realPower,
      gateState,
      offlineReports,
      log,
      emit: (view: GateView) => {
        emit({ type: 'gate', view });
        late.tray?.refresh();
      },
      onReleased: () => {
        if (!late.tray) {
          late.tray = createTray({
            isUnlocked: () => !lock.isLocked,
            onOpen: () => {
              win.show();
              win.focus();
            },
            onSignOut: () => {
              if (lock.isLocked) return;
              late.lockdown?.leaveForSignOut();
              void sessionSvc.logout();
            },
            onQuit: () => {
              if (!lock.canQuit()) return;
              quitting = true;
              app.quit();
            },
          });
        }
        late.tray.refresh();
        reminders.start();
        void late.lockdown?.retryPending();
      },
      onRelocked: () => {
        reminders.stop();
        late.tray?.refresh();
      },
    });

    const lockdown = new LockdownController({
      config,
      lock,
      window: windowPort,
      api,
      fs: realFs,
      pendingPath: join(userData, 'pending.json'),
      currentUserId: () => sessionSvc.getUser()?.id ?? null,
      emit,
      log,
      gate,
    });
    late.lockdown = lockdown;
    late.gate = gate;
    gate.attachLockdown(lockdown);
    void lockdown.loadPending();

    // ---- IPC ----------------------------------------------------------------------------------
    const registry = new IpcRegistry({
      ipc: ipcMain,
      log,
      validateSender: (event) => {
        const e = event as Electron.IpcMainInvokeEvent;
        const frame = e.senderFrame;
        return isAllowedSender({
          isMainWindow: !win.isDestroyed() && e.sender === win.webContents,
          isMainFrame: frame !== null && frame === win.webContents.mainFrame,
          url: frame?.url ?? '',
          devOrigin,
        });
      },
    });
    registry.register(
      buildHandlers({ config, api, session: sessionSvc, gate, lockdown, reminders }),
      IPC_CHANNEL_NAMES,
    );

    // ---- lifecycle ----------------------------------------------------------------------------
    app.on('before-quit', (event) => {
      if (!lock.canQuit()) {
        event.preventDefault();
        log.warn('quit.refused_while_locked');
      } else {
        quitting = true;
      }
    });
    // Electron destroys a window on a page-script `window.close()` with no cancellable event (found
    // by the Phase 5 e2e) and `allowScriptsToCloseWindows` is not configurable.
    // Layer 1: make the call a no-op for ordinary page script. `close` is an own property of the
    // global object (not of Window.prototype), so it can be redefined there. It is not a boundary:
    // `iframe.contentWindow.close.call(window)` reaches the native function of another realm and
    // really closes the window (measured on Electron 45). Frames are denied by the CSP, and the same
    // redefinition is applied to every frame Electron reports, but an initial about:blank frame is
    // usable in the same task it is created in, before any main-process hook can run (P5-L7).
    const neutraliseClose = (run: (code: string) => Promise<unknown>): void => {
      void run(
        "Object.defineProperty(window,'close',{value:function(){},writable:false,configurable:false});void 0;",
      ).catch(() => undefined);
    };
    win.webContents.on('dom-ready', () => {
      neutraliseClose((c) => win.webContents.executeJavaScript(c));
    });
    win.webContents.on('frame-created', (_event, details) => {
      const frame = details.frame;
      if (frame) neutraliseClose((c) => frame.executeJavaScript(c));
    });
    // Layer 2, the actual control: if the window is ever destroyed by something other than a normal
    // quit, restart so the gate returns. A running quiz is parked as a pending abandon FIRST (ids
    // only, bound to the user) so the attempt is closed server-side after the restart.
    win.on('closed', () => {
      if (quitting || lock.isSessionEnding) return;
      log.error('window.destroyed_unexpectedly');
      const restart = (): void => {
        // Unpackaged runs (e2e, dev) are started with tool-specific switches (for example a test
        // loader that waits for a debugger); restart cleanly from the app path instead.
        app.relaunch({ args: isPackaged ? process.argv.slice(1) : [app.getAppPath()] });
        app.exit(0);
      };
      const guard = setTimeout(restart, 2000);
      void Promise.all([lockdown.parkActiveForRestart(), log.flush?.()])
        .catch(() => undefined)
        .finally(() => {
          clearTimeout(guard);
          restart();
        });
    });
    app.on('second-instance', () => {
      if (win.isDestroyed()) return;
      win.show();
      win.focus();
    });
    app.on('window-all-closed', () => {
      // The tray keeps the app (reminders, clearance timers) alive; Quit is explicit and gated.
    });
    // Context-menu paste, Login inputs only (no other menu is ever built).
    win.webContents.on('context-menu', (_event, params) => {
      if (lock.state === 'gate' && gate.getView().phase === 'signed_out' && params.isEditable) {
        Menu.buildFromTemplate([{ role: 'paste', enabled: params.editFlags.canPaste }]).popup({
          window: win,
        });
      }
    });
    win.webContents.on('render-process-gone', () => {
      // Lockdown handles its own policy; outside lockdown just bring the UI back.
      if (lockdown.getState() !== 'active' && !win.isDestroyed()) win.webContents.reload();
    });

    if (config.autoStart) {
      app.setLoginItemSettings({ openAtLogin: true, args: ['--autostart'] });
    }

    // Cover the screen first, then load the UI, then start the (network) gate flow.
    lock.lock('gate');
    if (devUrl) void win.loadURL(devUrl);
    else void win.loadURL(`${APP_ORIGIN}/index.html`);
    // `start()` locks again (idempotent) before it makes its first request.
    void Promise.all([tokens.init(), gateState.load(), offlineReports.load()]).then(() =>
      gate.start(),
    );
  });
}
