import { expect, test } from '@playwright/test';
import { cleanup, forceClose, launchApp, windowState, type Launched } from './support/launch';

let s: Launched;

test.beforeAll(async () => {
  s = await launchApp();
});

test.afterAll(async () => {
  await forceClose(s.app);
  cleanup(s.userDataDir);
});

test('launches exactly one CSense window, locked, from the app:// origin, showing sign-in', async () => {
  await expect(s.page).toHaveTitle('CSense');
  await expect(s.page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  // Exactly one UI window (cover windows on extra displays are static pages without a bridge).
  expect(s.app.windows().filter((p) => p.url().endsWith('/index.html'))).toHaveLength(1);
  expect(s.page.url().startsWith('app://csense/')).toBe(true);
  const st = await windowState(s.app);
  expect(st).toMatchObject({ kiosk: true, alwaysOnTop: true, closable: false });
});

test('renderer has no Node.js access and the bridge is exactly the v1 surface', async () => {
  const info = await s.page.evaluate(() => {
    const g = globalThis as unknown as Record<string, unknown>;
    const b = g.csense as Record<string, unknown>;
    const methods = (k: string) => Object.keys(b[k] as object);
    return {
      require: typeof g.require,
      process: typeof g.process,
      ipc: typeof g.ipcRenderer,
      keys: Object.keys(b),
      frozen: Object.isFrozen(b),
      session: methods('session'),
      gate: methods('gate'),
      assessment: methods('assessment'),
      learning: methods('learning'),
      events: methods('events'),
      version: b.bridgeVersion,
    };
  });
  expect(info.require).toBe('undefined');
  expect(info.process).toBe('undefined');
  expect(info.ipc).toBe('undefined');
  expect(info.keys).toEqual([
    'bridgeVersion',
    'appVersion',
    'session',
    'gate',
    'assessment',
    'learning',
    'events',
  ]);
  expect(info.version).toBe(1);
  expect(info.frozen).toBe(true);
  expect(info.session).toEqual(['getState', 'login', 'logout']);
  expect(info.gate).toEqual([
    'getView',
    'requestChallenge',
    'submitAnswer',
    'continue',
    'continueOffline',
  ]);
  expect(info.assessment).toEqual(['startSecure', 'resume', 'submit', 'exit']);
  expect(info.learning).toEqual(['getOverview', 'getQuizOverview']);
  expect(info.events).toEqual(['subscribe']);
});

test('main process enforces renderer hardening', async () => {
  const prefs = await s.app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/index.html'),
    )?.webContents;
    return (
      wc as unknown as { getLastWebPreferences(): Record<string, unknown> }
    ).getLastWebPreferences();
  });
  expect(prefs).toMatchObject({
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webviewTag: false,
    webSecurity: true,
  });
});

test('the renderer is served with a strict CSP header (no network from the page)', async () => {
  const csp = await s.page.evaluate(async () => {
    const res = await fetch(location.href);
    return res.headers.get('content-security-policy');
  });
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
});
