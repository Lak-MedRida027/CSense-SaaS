import { join } from 'node:path';
import { app, BrowserWindow, shell } from 'electron';

const isDev = !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL);

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: 'CSense',
    backgroundColor: '#0b0f17',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  // Never open new windows from the renderer; hand http(s) links to the OS browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Block in-app navigation away from the bundled UI.
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev && url.startsWith(process.env.ELECTRON_RENDERER_URL ?? '');
    if (!allowed) event.preventDefault();
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

// Deny webview attachment and permission requests by default.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  contents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });
});

void app.whenReady().then(() => {
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
