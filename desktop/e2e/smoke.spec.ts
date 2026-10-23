import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

let app: ElectronApplication;

test.beforeAll(async () => {
  // Playwright runs from desktop/ (where playwright.config.mts lives).
  app = await electron.launch({ args: ['out/main/index.js'] });
});

test.afterAll(async () => {
  await app.close();
});

test('launches exactly one CSense window with the empty shell', async () => {
  const window = await app.firstWindow();
  await expect(window).toHaveTitle('CSense');
  await expect(window.getByRole('heading', { level: 1, name: 'CSense' })).toBeVisible();
  expect(app.windows()).toHaveLength(1);
});

test('renderer has no Node.js access', async () => {
  const window = await app.firstWindow();
  const globals = await window.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>).require,
    process: typeof (globalThis as Record<string, unknown>).process,
    bridgeKeys: Object.keys((globalThis as { csense?: object }).csense ?? {}),
  }));
  expect(globals.require).toBe('undefined');
  expect(globals.process).toBe('undefined');
  expect(globals.bridgeKeys).toEqual(['appVersion']);
});

test('main process enforces renderer hardening', async () => {
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0]?.webContents;
    // getLastWebPreferences is available on Electron's WebContents at runtime.
    return (
      wc as unknown as { getLastWebPreferences(): Record<string, unknown> }
    ).getLastWebPreferences();
  });
  expect(prefs).toMatchObject({ contextIsolation: true, sandbox: true, nodeIntegration: false });
});
