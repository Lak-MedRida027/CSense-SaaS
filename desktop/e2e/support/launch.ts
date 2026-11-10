import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { backend, type BackendInfo } from './backend';

export interface Launched {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
  backend: BackendInfo;
}

/**
 * Launch the built app against the harness. Runtime overrides are honoured because the app is
 * unpackaged (S2); devtools are off so the run exercises the production behaviour (plan 4.1).
 */
export async function launchApp(
  opts: { userDataDir?: string; env?: Record<string, string> } = {},
): Promise<Launched> {
  const b = backend();
  const userDataDir = opts.userDataDir ?? mkdtempSync(join(tmpdir(), 'csense-e2e-'));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.ELECTRON_RENDERER_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  Object.assign(env, {
    CSENSE_API_BASE_URL: b.baseUrl,
    CSENSE_USER_DATA_DIR: userDataDir,
    CSENSE_GATE_POLL_SECONDS: '2',
    CSENSE_DEVTOOLS: '0',
    ...opts.env,
  });
  // Re-launching on the same user data right after a force-exit can race the old process's helper
  // processes still releasing the single-instance lock and cache files: retry briefly.
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const app = await electron.launch({ args: ['out/main/index.js'], env });
      const page = await mainPage(app);
      return { app, page, userDataDir, backend: b };
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('electron.launch failed');
}

/**
 * The main window's page. On multi-display machines `firstWindow()` can be a cover window (a static
 * "CSense is locked" page), so wait for the one served from index.html.
 */
export async function mainPage(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const page = app.windows().find((p) => p.url().endsWith('/index.html'));
    if (page) {
      await page.waitForLoadState('domcontentloaded');
      return page;
    }
    if (Date.now() > deadline) throw new Error('main window did not load');
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Quit is refused while locked (that is the point), so tests end the process with `app.exit`,
 * which bypasses `before-quit`, then make sure nothing is left running.
 */
export async function forceClose(app: ElectronApplication): Promise<void> {
  const proc = app.process();
  const exited = new Promise<void>((resolve) => {
    if (proc.exitCode !== null) resolve();
    else
      proc.once('exit', () => {
        resolve();
      });
  });
  // An unlocked app quits normally (clean shutdown, so a relaunch on the same user data is clean);
  // a locked one refuses to quit, so it is exited directly.
  const unlocked = await app
    .evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some(
        (w) => w.webContents.getURL().endsWith('/index.html') && w.isClosable(),
      ),
    )
    .catch(() => false);
  if (unlocked) {
    await app
      .evaluate(({ app: a }) => {
        a.quit();
      })
      .catch(() => undefined);
  } else if (process.platform === 'win32' && proc.pid !== undefined) {
    // The whole process tree, so GPU/network helpers do not outlive the test and hold the profile.
    spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    proc.kill();
  }
  const killer = setTimeout(() => proc.kill(), 8000);
  await exited;
  clearTimeout(killer);
  // Helper processes release the profile directory a moment after the main process.
  await new Promise((r) => setTimeout(r, 1000));
}

export function cleanup(userDataDir: string): void {
  try {
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {
    // Temp data still held by a dying helper process: the OS temp cleaner will remove it.
  }
}

export interface WindowState {
  kiosk: boolean;
  alwaysOnTop: boolean;
  fullScreen: boolean;
  closable: boolean;
  minimizable: boolean;
  visible: boolean;
  contentProtected: boolean;
  windows: number;
}

/** State of the main (non-cover) window, read in the main process. */
export function windowState(app: ElectronApplication): Promise<WindowState> {
  return app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows();
    const w = all.find((x) => x.webContents.getURL().endsWith('/index.html'));
    if (!w) throw new Error('main window not found');
    return {
      kiosk: w.isKiosk(),
      alwaysOnTop: w.isAlwaysOnTop(),
      fullScreen: w.isFullScreen(),
      closable: w.isClosable(),
      minimizable: w.isMinimizable(),
      visible: w.isVisible(),
      contentProtected: w.isContentProtected(),
      windows: all.length,
    };
  });
}

export function devToolsOpen(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((w) => w.webContents.isDevToolsOpened()),
  );
}

export function clipboardText(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ clipboard }) => clipboard.readText());
}

export function setClipboard(app: ElectronApplication, text: string): Promise<void> {
  return app.evaluate(({ clipboard }, t) => clipboard.writeText(t), text);
}

/** Records, for each key-down, whether an earlier `before-input-event` listener (ours) prevented it. */
export async function installKeyProbe(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) =>
      x.webContents.getURL().endsWith('/index.html'),
    );
    if (!w) throw new Error('main window not found');
    const g = globalThis as unknown as { __keys?: { key: string; prevented: boolean }[] };
    g.__keys = [];
    w.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown')
        g.__keys?.push({ key: input.key, prevented: e.defaultPrevented });
    });
  });
}

export async function takeKeys(
  app: ElectronApplication,
): Promise<{ key: string; prevented: boolean }[]> {
  return app.evaluate(() => {
    const g = globalThis as unknown as { __keys?: { key: string; prevented: boolean }[] };
    const out = g.__keys ?? [];
    g.__keys = [];
    return out;
  });
}

/**
 * Dispatches a key through `webContents.sendInputEvent`. CDP-dispatched keys (Playwright's
 * `page.keyboard`) do NOT reach `before-input-event` in Electron 45, so they cannot exercise the
 * lockdown filter; this takes the same browser-side path as a real key press (plan 11, risk 4).
 * Returns what the filter decided for the key-down.
 */
export async function pressKey(
  app: ElectronApplication,
  keyCode: string,
  modifiers: ('control' | 'shift' | 'alt' | 'meta')[] = [],
): Promise<{ key: string; prevented: boolean }[]> {
  await takeKeys(app);
  await app.evaluate(
    ({ BrowserWindow }, a) => {
      const w = BrowserWindow.getAllWindows().find((x) =>
        x.webContents.getURL().endsWith('/index.html'),
      );
      if (!w) throw new Error('main window not found');
      w.webContents.sendInputEvent({ type: 'keyDown', keyCode: a.keyCode, modifiers: a.modifiers });
      // Activating a focused button needs the character event a real keyboard also produces.
      if (a.keyCode === 'Enter')
        w.webContents.sendInputEvent({ type: 'char', keyCode: String.fromCharCode(13) });
      if (a.keyCode === 'Space') w.webContents.sendInputEvent({ type: 'char', keyCode: ' ' });
      w.webContents.sendInputEvent({ type: 'keyUp', keyCode: a.keyCode, modifiers: a.modifiers });
    },
    { keyCode, modifiers },
  );
  return takeKeys(app);
}

/**
 * `safeStorage` keeps its key in the profile's `Local State`, which Chromium commits about 10 s
 * after first use. A process killed before that cannot decrypt its own session file at the next
 * launch (the app then safely starts signed out). Tests that kill the process wait for the flush.
 */
export async function waitForCryptoKeyFlush(userDataDir: string): Promise<void> {
  const file = join(userDataDir, 'Local State');
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (existsSync(file) && readFileSync(file, 'utf8').includes('os_crypt')) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('safeStorage key was not committed to Local State');
}

/**
 * Kills every Electron process started from THIS worktree's electron binary (by executable path),
 * including instances the app relaunched on its own, which Playwright does not track.
 */
export function killWorktreeElectron(): void {
  if (process.platform !== 'win32') return;
  const dist = join(process.cwd(), '..', 'node_modules', 'electron', 'dist').replace(/\//g, '\\');
  spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `$d = [IO.Path]::GetFullPath('${dist.replace(/'/g, "''")}'); ` +
        "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($d, 'OrdinalIgnoreCase') } | " +
        'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
    ],
    { stdio: 'ignore' },
  );
}
