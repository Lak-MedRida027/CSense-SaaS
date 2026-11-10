import { expect, test, type Page } from '@playwright/test';
import { answerCorrectly, signIn } from './support/keys';
import {
  cleanup,
  clipboardText,
  devToolsOpen,
  forceClose,
  installKeyProbe,
  launchApp,
  pressKey,
  setClipboard,
  windowState,
  type Launched,
} from './support/launch';

/**
 * Playbook gate, part 3: quiz lockdown is active and the obvious escapes fail (plan 11, 12.5).
 * Keys go through `webContents.sendInputEvent`: CDP-dispatched keys never reach the filter.
 */
test.describe.serial('quiz lockdown', () => {
  let s: Launched;
  let page: Page;

  const banner = () => page.getByRole('region', { name: 'Secure quiz mode' });

  async function startQuiz(): Promise<void> {
    await page.getByRole('button', { name: /Start quiz/ }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Ready for the quiz?' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Start secure quiz' }).click();
    await expect(banner().getByText('Secure quiz mode is on')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('radio').first()).toBeAttached();
  }

  async function backToHome(): Promise<void> {
    // A result that is not a pass offers "Back to training"; a pass offers "Back to training" too.
    await page.getByRole('button', { name: 'Back to training' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Your training' })).toBeVisible();
  }

  test.beforeAll(async () => {
    s = await launchApp();
    page = s.page;
    const acct = s.backend.accounts.quiz;
    await signIn(page, acct.email, acct.password);
    await expect(page.getByRole('heading', { level: 1, name: 'Security check' })).toBeVisible();
    await answerCorrectly(page, s.backend);
    await page.getByRole('button', { name: /Continue now/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Your training' })).toBeVisible();
    // Module 1's content is pre-completed by the harness, so its quiz can start.
    await expect(page.getByRole('button', { name: /Start quiz/ })).toBeVisible({ timeout: 15_000 });
  });

  test.afterAll(async () => {
    await forceClose(s.app);
    cleanup(s.userDataDir);
  });

  test('1. Start secure quiz: kiosk, always on top, content protected; the clipboard is emptied; questions are visible', async () => {
    await setClipboard(s.app, 'secret text copied before the quiz');
    expect(await clipboardText(s.app)).not.toBe('');
    expect(await windowState(s.app)).toMatchObject({ kiosk: false, closable: true });
    await startQuiz();
    expect(await windowState(s.app)).toMatchObject({
      kiosk: true,
      alwaysOnTop: true,
      fullScreen: true,
      closable: false,
      minimizable: false,
      contentProtected: true,
      visible: true,
    });
    expect(await clipboardText(s.app)).toBe('');
    await expect(page.getByRole('button', { name: 'Exit quiz' })).toBeVisible();
  });

  test('2. every obvious escape fails and the quiz stays active', async () => {
    await installKeyProbe(s.app);
    await page.evaluate(() => {
      (window as unknown as { __marker: number }).__marker = 42;
    });

    // Select question text, then try to copy it, paste into the clipboard-less window, cut.
    await page.evaluate(() => {
      const el = document.querySelector('legend, h2, p');
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    });
    const blocked: [string, ('control' | 'shift' | 'alt')[]][] = [
      ['C', ['control']],
      ['V', ['control']],
      ['X', ['control']],
      ['Insert', ['control']],
      ['Insert', ['shift']],
      ['R', ['control']],
      ['F5', []],
      ['F11', []],
      ['F12', []],
      ['I', ['control', 'shift']],
      ['W', ['control']],
      ['P', ['control']],
      ['F4', ['alt']],
      ['Left', ['alt']],
    ];
    for (const [code, mods] of blocked) {
      const seen = await pressKey(s.app, code, mods);
      expect(seen.length, `${mods.join('+')}+${code} reached the filter`).toBeGreaterThan(0);
      expect(seen[0]?.prevented, `${mods.join('+')}+${code} prevented`).toBe(true);
    }
    expect(await clipboardText(s.app)).toBe('');
    expect(await devToolsOpen(s.app)).toBe(false);
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(
      42,
    );

    // Escape reaches the page (to close the exit dialog) but never ends lockdown.
    const esc = await pressKey(s.app, 'Escape');
    expect(esc[0]?.prevented).toBe(false);
    expect(await windowState(s.app)).toMatchObject({ kiosk: true, closable: false });

    // Closing the window (F11 itself was tried above).
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) =>
        x.webContents.getURL().endsWith('/index.html'),
      );
      w?.close();
    });
    await page.waitForTimeout(500);
    expect(await windowState(s.app)).toMatchObject({ kiosk: true, visible: true });

    // With devtools disabled in webPreferences (CSENSE_DEVTOOLS=0, as in production) an attempt to
    // open them does nothing; the `devtools-opened` violation path is covered by the LC8 unit test.
    await s.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((x) => x.webContents.getURL().endsWith('/index.html'))
        ?.webContents.openDevTools({ mode: 'detach' });
    });
    await expect.poll(() => devToolsOpen(s.app), { timeout: 5000 }).toBe(false);

    await expect(banner().getByText('Secure quiz mode is on')).toBeVisible();
    await expect(page.getByRole('radio').first()).toBeAttached();
  });

  test('3. focus loss: a warning first, then the attempt ends as abandoned and the window unlocks', async () => {
    const blurOnce = async () => {
      await s.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()
          .find((x) => x.webContents.getURL().endsWith('/index.html'))
          ?.blur();
      });
    };
    await blurOnce();
    await expect(banner().getByRole('alert')).toContainText(
      'You left secure mode. Leaving 2 more times ends this attempt.',
      { timeout: 8000 },
    );
    expect((await windowState(s.app)).kiosk).toBe(true);

    // Two more losses end the attempt. Wait for each refocus before the next blur.
    await page.waitForTimeout(800);
    await blurOnce();
    await expect(banner().getByRole('alert')).toContainText('Leaving 1 more time ends', {
      timeout: 8000,
    });
    await page.waitForTimeout(800);
    await blurOnce();

    await expect(page.getByText('This attempt ended because CSense lost focus.')).toBeVisible({
      timeout: 10_000,
    });
    expect(await windowState(s.app)).toMatchObject({
      kiosk: false,
      closable: true,
      contentProtected: false,
    });
    await backToHome();
  });

  test('4. keyboard only: Tab to "Exit quiz", Enter, Tab to "Leave quiz", Enter -> unlocked', async () => {
    await startQuiz();
    await setClipboard(s.app, 'typed during the quiz');

    const focusedText = () => page.evaluate(() => document.activeElement?.textContent.trim() ?? '');
    const tabTo = async (label: string) => {
      for (let i = 0; i < 25; i++) {
        if ((await focusedText()) === label) return;
        await pressKey(s.app, 'Tab');
        await page.waitForTimeout(60);
      }
      throw new Error(`could not Tab to "${label}" (no keyboard trap expected)`);
    };

    await tabTo('Exit quiz');
    await pressKey(s.app, 'Enter');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    expect(await focusedText()).toBe('Keep going'); // the safe choice is focused
    await tabTo('Leave quiz');
    await pressKey(s.app, 'Enter');

    await expect(page.getByText(/You left the quiz/)).toBeVisible({ timeout: 15_000 });
    expect(await windowState(s.app)).toMatchObject({ kiosk: false, closable: true });
    expect(await clipboardText(s.app)).toBe('');
    // The filter is off again: Ctrl+C is no longer blocked.
    await installKeyProbe(s.app);
    const seen = await pressKey(s.app, 'C', ['control']);
    expect(seen[0]?.prevented).toBe(false);
    await backToHome();
  });

  test('5. answering and submitting shows the result and exits lockdown', async () => {
    await startQuiz();
    // Answer every question (first option), review, submit.
    for (let i = 0; i < 50; i++) {
      await page.getByRole('radio').first().check({ force: true });
      const next = page.getByRole('button', { name: /Next question/ });
      if (await next.isVisible()) await next.click();
      else break;
    }
    await page.getByRole('button', { name: /Review and submit/ }).click();
    await page.getByRole('button', { name: /^Submit/ }).click();
    await expect(
      page
        .getByText(/% /)
        .or(page.getByText(/correct/))
        .first(),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByRole('heading', { level: 1 }).filter({ hasText: /Passed|Not passed/ }),
    ).toBeVisible();
    expect(await windowState(s.app)).toMatchObject({
      kiosk: false,
      closable: true,
      contentProtected: false,
    });
    expect(await clipboardText(s.app)).toBe('');
  });
});

/**
 * Crash recovery has its own app: Playwright marks a page whose renderer crashed as dead for good,
 * so the rest of the page-level checks are made from the main process (`executeJavaScript`).
 */
test('renderer crash: resumed once and still locked; a second crash ends the attempt (D5-16)', async () => {
  const s = await launchApp();
  try {
    const page = s.page;
    const acct = s.backend.accounts.quiz;
    await signIn(page, acct.email, acct.password);
    // The clearance from the other spec is still valid, so the gate auto-continues; otherwise answer.
    await Promise.race([
      page.getByRole('heading', { level: 1, name: 'Your training' }).waitFor({ timeout: 20_000 }),
      page
        .getByRole('heading', { level: 1, name: 'Security check' })
        .waitFor({ timeout: 20_000 })
        .then(async () => {
          await answerCorrectly(page, s.backend);
          await page.getByRole('button', { name: /Continue now/ }).click();
        }),
    ]);
    await page.getByRole('button', { name: /Start quiz/ }).click();
    await page.getByRole('button', { name: 'Start secure quiz' }).click();
    await expect(page.getByText('Secure quiz mode is on')).toBeVisible({ timeout: 15_000 });

    const bodyText = (): Promise<string> =>
      s.app.evaluate(async ({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find((x) =>
          x.webContents.getURL().endsWith('/index.html'),
        );
        return w ? String(await w.webContents.executeJavaScript('document.body.innerText')) : '';
      });
    const crash = (): Promise<void> =>
      s.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()
          .find((x) => x.webContents.getURL().endsWith('/index.html'))
          ?.webContents.forcefullyCrashRenderer();
      });

    await crash();
    await expect
      .poll(() => bodyText().catch(() => ''), { timeout: 30_000 })
      .toContain('CSense restarted the quiz screen');
    expect(await bodyText()).toMatch(/QUESTION 1 OF/i);
    expect(await windowState(s.app)).toMatchObject({ kiosk: true, contentProtected: true });

    await crash();
    await expect
      .poll(() => bodyText().catch(() => ''), { timeout: 30_000 })
      .toContain('Your training');
    expect(await windowState(s.app)).toMatchObject({ kiosk: false, closable: true });
  } finally {
    await forceClose(s.app);
    cleanup(s.userDataDir);
  }
});
