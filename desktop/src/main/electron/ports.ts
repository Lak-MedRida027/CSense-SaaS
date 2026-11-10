/**
 * The only module (with the shell glue under `security/`, `bootstrap.ts` and `tray.ts`) that touches
 * `electron`. Everything else depends on the port interfaces in `types.ts` (ADR 0013 item 9).
 */
import { promises as nodeFs } from 'node:fs';
import {
  BrowserWindow,
  Notification,
  clipboard,
  globalShortcut,
  powerMonitor,
  safeStorage,
  screen,
  session,
  type Display,
} from 'electron';
import { WINDOW_BACKGROUND } from '../../renderer/src/design/tokens/electron';
import { APP_ORIGIN } from '../security/policy';
import type {
  ClipboardPort,
  CoverWindowPort,
  DisplayInfo,
  DisplaysPort,
  FetchPort,
  FsPort,
  GlobalShortcutPort,
  NotificationPort,
  PowerPort,
  SafeStoragePort,
  WindowPort,
} from './types';

export const API_PARTITION = 'csense-api';

export const realFs: FsPort = {
  async readFile(path) {
    try {
      return await nodeFs.readFile(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  },
  async writeFile(path, data) {
    await nodeFs.writeFile(path, data, { mode: 0o600 });
  },
  async rename(from, to) {
    await nodeFs.rename(from, to);
  },
  async unlink(path) {
    try {
      await nodeFs.unlink(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  },
  async mkdir(dir) {
    await nodeFs.mkdir(dir, { recursive: true });
  },
  async appendFile(path, data) {
    await nodeFs.appendFile(path, data, { mode: 0o600 });
  },
  async fileSize(path) {
    try {
      return (await nodeFs.stat(path)).size;
    } catch {
      return 0;
    }
  },
};

export function createSafeStoragePort(): SafeStoragePort {
  return {
    isEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
    selectedBackend: () =>
      // Only Linux has a selectable backend; Windows (DPAPI) and macOS (Keychain) are real encryption.
      process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'os_default',
    encryptString: (plain) => safeStorage.encryptStringAsync(plain),
    decryptString: async (blob) => (await safeStorage.decryptStringAsync(blob)).result,
  };
}

export const realClipboard: ClipboardPort = {
  clear: () => {
    clipboard.clear();
    if (process.platform === 'linux') clipboard.selection.clear();
  },
  readText: () => clipboard.readText(),
};

export const realGlobalShortcut: GlobalShortcutPort = {
  register: (accelerator, callback) => globalShortcut.register(accelerator, callback),
  unregister: (accelerator) => {
    globalShortcut.unregister(accelerator);
  },
};

export const realNotification: NotificationPort = {
  isSupported: () => Notification.isSupported(),
  show: ({ title, body }, onClick) => {
    const n = new Notification({ title, body, silent: false });
    n.on('click', onClick);
    n.show();
  },
};

export const realPower: PowerPort = {
  on(event, callback) {
    const emitter: NodeJS.EventEmitter = powerMonitor;
    emitter.on(event, callback);
    return () => {
      emitter.removeListener(event, callback);
    };
  },
};

/** The API session: separate, in-memory (no `persist:` prefix), so the UI egress filter never applies. */
export function createApiFetch(): FetchPort {
  const ses = session.fromPartition(API_PARTITION);
  return (url, init) => ses.fetch(url, init);
}

export function createWindowPort(win: BrowserWindow): WindowPort {
  const wc = win.webContents;
  return {
    isDestroyed: () => win.isDestroyed(),
    show: () => {
      win.show();
    },
    hide: () => {
      win.hide();
    },
    focus: () => {
      win.focus();
    },
    moveTop: () => {
      win.moveTop();
    },
    flashFrame: (flag) => {
      win.flashFrame(flag);
    },
    center: () => {
      win.center();
    },
    setSize: (w, h) => {
      win.setSize(w, h);
    },
    setKiosk: (f) => {
      win.setKiosk(f);
    },
    setFullScreen: (f) => {
      win.setFullScreen(f);
    },
    setAlwaysOnTop: (f, level) => {
      if (level) win.setAlwaysOnTop(f, level);
      else win.setAlwaysOnTop(f);
    },
    setClosable: (f) => {
      win.setClosable(f);
    },
    setMinimizable: (f) => {
      win.setMinimizable(f);
    },
    setMovable: (f) => {
      win.setMovable(f);
    },
    setSkipTaskbar: (f) => {
      win.setSkipTaskbar(f);
    },
    setContentProtection: (f) => {
      win.setContentProtection(f);
    },
    closeDevTools: () => {
      if (wc.isDevToolsOpened()) wc.closeDevTools();
    },
    reload: () => {
      if (!win.isDestroyed()) wc.reload();
    },
    forcefullyCrashRenderer: () => {
      wc.forcefullyCrashRenderer();
    },
    send: (channel, payload) => {
      if (!win.isDestroyed() && !wc.isDestroyed()) wc.send(channel, payload);
    },
    onBeforeInput: (handler) => {
      const l = (event: Electron.Event, input: Electron.Input): void => {
        if (handler(input)) event.preventDefault();
      };
      wc.on('before-input-event', l);
      return () => wc.removeListener('before-input-event', l);
    },
    onClose: (handler) => {
      const l = (event: Electron.Event): void => {
        if (handler()) event.preventDefault();
      };
      win.on('close', l);
      return () => win.removeListener('close', l);
    },
    onBlur: (handler) => {
      win.on('blur', handler);
      return () => win.removeListener('blur', handler);
    },
    onFocus: (handler) => {
      win.on('focus', handler);
      return () => win.removeListener('focus', handler);
    },
    onDevToolsOpened: (handler) => {
      wc.on('devtools-opened', handler);
      return () => wc.removeListener('devtools-opened', handler);
    },
    onRenderProcessGone: (handler) => {
      const l = (_e: Electron.Event, details: Electron.RenderProcessGoneDetails): void => {
        handler({ reason: details.reason });
      };
      wc.on('render-process-gone', l);
      return () => wc.removeListener('render-process-gone', l);
    },
    onUnresponsive: (handler) => {
      win.on('unresponsive', handler);
      return () => win.removeListener('unresponsive', handler);
    },
    onResponsive: (handler) => {
      win.on('responsive', handler);
      return () => win.removeListener('responsive', handler);
    },
    onSessionEnd: (handler) => {
      win.on('session-end', handler);
      return () => win.removeListener('session-end', handler);
    },
  };
}

function toInfo(d: Display): DisplayInfo {
  return { id: d.id, bounds: d.bounds };
}

/** Cover windows load a static, script-free page from the app origin and have no preload (plan 4.1). */
export function createDisplaysPort(win: BrowserWindow): DisplaysPort {
  return {
    all: () => screen.getAllDisplays().map(toInfo),
    windowDisplayId: () => screen.getDisplayMatching(win.getBounds()).id,
    onChange: (callback) => {
      screen.on('display-added', callback);
      screen.on('display-removed', callback);
      screen.on('display-metrics-changed', callback);
      return () => {
        screen.removeListener('display-added', callback);
        screen.removeListener('display-removed', callback);
        screen.removeListener('display-metrics-changed', callback);
      };
    },
    createCover(display): CoverWindowPort {
      const cover = new BrowserWindow({
        ...display.bounds,
        frame: false,
        show: false,
        movable: false,
        resizable: false,
        minimizable: false,
        closable: false,
        focusable: false,
        skipTaskbar: true,
        fullscreenable: false,
        backgroundColor: WINDOW_BACKGROUND.dark,
        webPreferences: {
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webSecurity: true,
          devTools: false,
          // No preload: a cover can never reach the bridge.
        },
      });
      cover.setAlwaysOnTop(true, 'screen-saver');
      cover.setMenuBarVisibility(false);
      void cover.loadURL(`${APP_ORIGIN}/cover.html`);
      cover.once('ready-to-show', () => {
        cover.showInactive();
      });
      // Not closable: only `close()` below (via destroy) removes it.
      return {
        setBounds: (b) => {
          if (!cover.isDestroyed()) cover.setBounds(b);
        },
        close: () => {
          if (!cover.isDestroyed()) cover.destroy();
        },
      };
    },
  };
}
