import { expect, test } from '@playwright/test';
import { answerCorrectly, answerWrongly, currentPrompt, signIn } from './support/keys';
import {
  cleanup,
  devToolsOpen,
  forceClose,
  installKeyProbe,
  launchApp,
  pressKey,
  windowState,
  type Launched,
} from './support/launch';

/**
 * Playbook gate, part 1: the gate blocks, then grants (plan 12.5). Serial: each step builds on the
 * previous one, and the last step relaunches with the same user data.
 */
test.describe.serial('security gate: blocks, then grants', () => {
  let s: Launched;
  let userDataDir: string;

  test.afterAll(async () => {
    await forceClose(s.app);
    cleanup(userDataDir);
  });

  test('1. launches locked into the gate; Login is shown', async () => {
    s = await launchApp();
    userDataDir = s.userDataDir;
    await expect(s.page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    expect(await windowState(s.app)).toMatchObject({
      kiosk: true,
      alwaysOnTop: true,
      fullScreen: true,
      closable: false,
      minimizable: false,
      visible: true,
    });
  });

  test('2. the obvious escapes fail', async () => {
    await installKeyProbe(s.app);

    // Closing the window: the OS close command (what Alt+F4 ends up doing) and page script.
    await s.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('/index.html'))
        ?.close();
    });
    await s.page.evaluate(() => {
      window.close();
    });
    await s.page.waitForTimeout(500);
    expect(s.page.isClosed()).toBe(false);

    // Keys: each must be prevented by the main-process filter before the page sees it.
    const combos: [string, string, ('control' | 'shift' | 'alt')[]][] = [
      ['F4', 'F4', ['alt']],
      ['W', 'w', ['control']],
      ['R', 'r', ['control']],
      ['F5', 'F5', []],
      ['F11', 'F11', []],
      ['F12', 'F12', []],
      ['I', 'I', ['control', 'shift']],
      ['C', 'c', ['control']],
    ];
    for (const [code, key, mods] of combos) {
      const seen = await pressKey(s.app, code, mods);
      const hit = seen.find((x) => x.key.toLowerCase() === key.toLowerCase());
      expect(hit, `${mods.join('+')}+${code} reached before-input-event`).toBeDefined();
      expect(hit?.prevented, `${mods.join('+')}+${code} prevented`).toBe(true);
    }
    // Control: ordinary navigation keys are NOT blocked (no keyboard trap).
    expect((await pressKey(s.app, 'Tab'))[0]?.prevented).toBe(false);
    expect(await devToolsOpen(s.app)).toBe(false);

    const st = await windowState(s.app);
    expect(st).toMatchObject({ kiosk: true, alwaysOnTop: true, closable: false, visible: true });
    await expect(s.page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  });

  test('3. gate.continue() before a grant is refused (S16)', async () => {
    const res = await s.page.evaluate(() => window.csense?.gate.continue());
    expect(res).toMatchObject({ ok: false, error: { code: 'GATE_LOCKED' } });
    expect((await windowState(s.app)).kiosk).toBe(true);
    const offline = await s.page.evaluate(() => window.csense?.gate.continueOffline());
    expect(offline).toMatchObject({ ok: false, error: { code: 'GATE_LOCKED' } });
  });

  test('4. a wrong login shows the generic error; the right login reaches the challenge (3 of 3)', async () => {
    const acct = s.backend.accounts['gate-pass'];
    await signIn(s.page, acct.email, 'definitely-not-the-password');
    await expect(s.page.getByText('Email or password is incorrect.')).toBeVisible();
    // The password field was cleared after the attempt.
    await expect(s.page.getByLabel(/Password/)).toHaveValue('');
    await signIn(s.page, acct.email, acct.password);
    await expect(s.page.getByRole('heading', { level: 1, name: 'Security check' })).toBeVisible();
    await expect(s.page.getByText(/3 of 3/)).toBeVisible();
    expect((await windowState(s.app)).kiosk).toBe(true);
  });

  test('5. a wrong answer: "Not quite", 2 remaining, a different question', async () => {
    const before = await currentPrompt(s.page);
    await answerWrongly(s.page, s.backend);
    await expect(s.page.getByText('Not quite')).toBeVisible();
    await expect(s.page.getByText(/2 of 3/)).toBeVisible();
    await expect.poll(() => currentPrompt(s.page)).not.toBe(before);
    expect((await windowState(s.app)).kiosk).toBe(true);
    // The correct option is never shown on a failure: the explanation teaches, it does not name it.
    const body = await s.page.locator('body').innerText();
    expect(body).not.toMatch(/correct answer is/i);
  });

  test('6. the correct answer grants access, but the workstation stays locked until Continue', async () => {
    await answerCorrectly(s.page, s.backend);
    await expect(s.page.getByRole('heading', { level: 1, name: 'Access granted' })).toBeVisible();
    expect((await windowState(s.app)).kiosk).toBe(true);
  });

  test('7. Continue unlocks the window and lands on the training home', async () => {
    await s.page.getByRole('button', { name: /Continue now/ }).click();
    await expect(s.page.getByRole('heading', { level: 1, name: 'Your training' })).toBeVisible();
    const st = await windowState(s.app);
    expect(st).toMatchObject({ kiosk: false, alwaysOnTop: false, closable: true });
  });

  test('8. relaunch with the same user data: session resumes, clearance auto-continues, no new question', async () => {
    await forceClose(s.app);
    s = await launchApp({ userDataDir });
    // The gate is shown first ("Access granted") and continues by itself after ~2 s.
    await expect(s.page.getByRole('heading', { level: 1, name: 'Your training' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(s.page.getByRole('heading', { name: 'Security check' })).toHaveCount(0);
    expect((await windowState(s.app)).kiosk).toBe(false);
  });
});

/**
 * Navigation escapes live in their own test with their own app: after a cancelled top-level
 * navigation Playwright keeps waiting for a navigation that never commits, which would stall every
 * later `expect` on that page. That is a test-tool quirk, not app behaviour.
 */
test('navigation and new windows are denied while the gate is locked (S3)', async () => {
  const s = await launchApp();
  try {
    await s.page.evaluate(() => {
      window.open('https://example.com/');
      location.href = 'https://example.com/';
    });
    await s.page.waitForTimeout(1000);
    expect(s.page.url().startsWith('app://csense/')).toBe(true);
    expect(s.app.windows().some((p) => p.url().includes('example.com'))).toBe(false);
    const title = await s.page.evaluate(() => document.querySelector('h1')?.textContent);
    expect(title).toBe('Sign in');
    expect(await windowState(s.app)).toMatchObject({ kiosk: true, closable: false });
  } finally {
    await forceClose(s.app);
    cleanup(s.userDataDir);
  }
});
