/**
 * Electron hardening glue (plan 4.1). Applies the pure decisions in `policy.ts` to every window,
 * web contents and session. Development relaxations are keyed on `app.isPackaged === false` only.
 */
import { join } from 'node:path';
import { app, shell, type BrowserWindowConstructorOptions, type Session } from 'electron';
import { WINDOW_BACKGROUND } from '../../renderer/src/design/tokens/electron';
import type { Logger } from '../log';
import {
  isAllowedEgress,
  isAllowedNavigation,
  isExternalLinkAllowed,
  type OriginContext,
} from './policy';

export interface HardeningContext extends OriginContext {
  devToolsAllowed: boolean;
  externalLinkHosts: readonly string[];
  log: Logger;
}

export function mainWindowOptions(ctx: {
  devToolsAllowed: boolean;
}): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 800,
    show: false,
    frame: false,
    title: 'CSense',
    // Matches the dark surface-canvas token so there is no flash before first paint.
    backgroundColor: WINDOW_BACKGROUND.dark,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
      devTools: ctx.devToolsAllowed,
    },
  };
}

/** UI session: deny permissions and devices, and cancel every request outside the app origin. */
export function hardenUiSession(ses: Session, ctx: HardeningContext): void {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });
  ses.setPermissionCheckHandler(() => false);
  ses.setDisplayMediaRequestHandler((_request, callback) => {
    callback({});
  });
  ses.on('select-usb-device', (event, _details, callback) => {
    event.preventDefault();
    callback();
  });
  ses.on('select-hid-device', (event, _details, callback) => {
    event.preventDefault();
    callback();
  });
  ses.on('select-serial-port', (event, _portList, _wc, callback) => {
    event.preventDefault();
    callback('');
  });
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const allowed = isAllowedEgress(details.url, {
      devOrigin: ctx.devOrigin,
      allowDevTools: !app.isPackaged && ctx.devToolsAllowed,
    });
    if (!allowed) ctx.log.warn('egress.blocked', { scheme: safeScheme(details.url) });
    callback({ cancel: !allowed });
  });
}

function safeScheme(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    return 'invalid';
  }
}

/** Applied to every webContents (`web-contents-created`), including future ones. */
export function hardenWebContents(contents: Electron.WebContents, ctx: HardeningContext): void {
  const block = (event: Electron.Event, url: string): void => {
    if (!isAllowedNavigation(url, ctx)) {
      event.preventDefault();
      ctx.log.warn('navigation.blocked', { scheme: safeScheme(url) });
    }
  };
  contents.on('will-navigate', (event) => {
    block(event, event.url);
  });
  contents.on('will-frame-navigate', (event) => {
    block(event, event.url);
  });
  contents.on('will-redirect', (event) => {
    block(event, event.url);
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalLinkAllowed(url, ctx.externalLinkHosts)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('select-bluetooth-device', (event, _list, callback) => {
    event.preventDefault();
    callback('');
  });
  // Web Notification is denied by the permission handler; only main shows notifications.
}

/** TLS errors are never overridden (S23). */
export function denyCertificateErrors(log: Logger): void {
  app.on('certificate-error', (event, _wc, url, error, _cert, callback) => {
    event.preventDefault();
    log.warn('tls.certificate_error', { error, scheme: safeScheme(url) });
    callback(false);
  });
}
