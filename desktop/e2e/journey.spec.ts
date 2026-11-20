/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test';
import {
  DASHBOARD_HEADING,
  answerQuiz,
  axeCheck,
  finishLesson,
  levelForXp,
  meXp,
  onboardingState,
  passGate,
  readDashboard,
  startSecureQuiz,
  submitQuiz,
} from './support/journey';
import { cleanup, forceClose, launchApp, windowState, type Launched } from './support/launch';

/**
 * Playbook gate: the whole employee journey in the running app (plan 9.5). A seeded employee signs
 * in, passes the gate, is welcomed, completes all seven modules (one failed attempt with review and
 * retry), sees real XP, level and badges on the dashboard, passes the final assessment, and relaunches
 * without onboarding. Serial: each step builds on the previous one.
 */
test.describe.serial('employee journey', () => {
  let s: Launched;
  let userDataDir: string;
  let page: Page;
  const earned: number[] = [];
  const GATE_XP = 10;

  test.afterAll(async () => {
    await forceClose(s.app);
    cleanup(userDataDir);
  });

  const heading = (name: string | RegExp) => page.getByRole('heading', { level: 1, name });

  async function xpFromResult(): Promise<void> {
    const text = (await page.getByText(/^\+\d+ XP$/).innerText()).replace(/\D/g, '');
    earned.push(Number(text));
  }

  /** Closes the achievement dialog if the pass produced one. */
  async function closeAchievement(): Promise<void> {
    await expect(heading(DASHBOARD_HEADING)).toBeVisible();
    const dialog = page.getByRole('dialog');
    const shown = await dialog
      .waitFor({ timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (shown) {
      await dialog.getByRole('button', { name: 'Continue' }).click();
      await expect(dialog).toBeHidden();
    }
  }

  /** Practice stage: answer each scenario from the harness key; optionally get the first one wrong. */
  async function practice(opts: { firstWrong?: boolean } = {}): Promise<void> {
    await page.getByRole('button', { name: 'Continue to practice' }).click();
    for (let i = 0; i < 20; i++) {
      const prompt = (await page.locator('legend').first().innerText()).trim();
      const key = s.backend.exerciseKey[prompt];
      if (key === undefined) throw new Error(`no harness key for exercise: ${prompt}`);
      const count = await page.getByRole('radio').count();
      const wrong = opts.firstWrong === true && i === 0;
      await page
        .getByRole('radio')
        .nth(wrong ? (key + 1) % count : key)
        .click({ force: true });
      const feedback = page.getByRole('heading', { name: wrong ? 'Not quite' : 'Correct' });
      await expect(feedback).toBeVisible();
      if (wrong) {
        await expect(feedback).toBeFocused();
        await expect(page.getByText('Correct answer', { exact: true })).toBeVisible();
        await axeCheck(page, 'practice feedback');
      }
      const last = await page.getByRole('button', { name: 'Continue to quiz' }).isVisible();
      await page.getByRole('button', { name: last ? 'Continue to quiz' : 'Next scenario' }).click();
      if (last) return;
    }
    throw new Error('too many scenarios');
  }

  /** Whole module via its lesson (transcript path for video), optional practice, then the quiz. */
  async function completeModule(
    opts: { wrong?: number; firstWrong?: boolean } = {},
  ): Promise<void> {
    await page.getByRole('button', { name: /^(Start|Resume) module/ }).click();
    await expect(heading(DASHBOARD_HEADING)).toBeHidden();
    await finishLesson(page);
    if (await page.getByRole('button', { name: 'Continue to practice' }).isVisible()) {
      await practice({ firstWrong: opts.firstWrong ?? false });
    } else {
      await page.getByRole('button', { name: 'Continue to quiz' }).click();
    }
    await expect(heading('Ready for the quiz?')).toBeVisible();
    await startSecureQuiz(page);
    await answerQuiz(page, s.backend, { wrong: opts.wrong ?? 0 });
    await submitQuiz(page);
  }

  async function passModule(): Promise<void> {
    await completeModule();
    await expect(heading(/Passed/)).toBeVisible();
    await xpFromResult();
    await page.getByRole('button', { name: 'Continue' }).click();
    await closeAchievement();
  }

  test('1. first login: gate, then onboarding, then Module 1 (display choice persists)', async () => {
    s = await launchApp();
    userDataDir = s.userDataDir;
    page = s.page;
    await passGate(page, s.backend, 'journey');
    await expect(heading('Welcome to CSense, Jordan')).toBeVisible();
    await axeCheck(page, 'onboarding');
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /Next/ }).click();
    await page.getByRole('radio', { name: 'Light' }).check({ force: true });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: 'Start Module 1' }).click();
    await expect(page.getByText('Module 1 of 7')).toBeVisible();
    expect((await onboardingState(s.backend, 'journey'))?.outcome).toBe('completed');
  });

  test('2. Module 1 (video): bundled media with captions, watched rule, quiz, badge, level-up', async () => {
    test.setTimeout(150_000);
    const video = page.locator('video');
    await expect(video).toHaveAttribute('src', /^app:\/\/csense\/media\//);
    await expect(page.locator('video track')).toHaveAttribute('src', /^app:\/\/csense\/media\//);
    const action = page.getByRole('button', { name: 'Continue to quiz' });
    await expect(action).toHaveAttribute('aria-disabled', 'true');
    await expect(
      page.getByText('Watch the video or read the transcript to continue'),
    ).toBeVisible();
    await axeCheck(page, 'module player (video)');

    // Play the 8 second clip through (contiguously) and the action enables.
    await video.evaluate(async (el: HTMLVideoElement) => {
      el.muted = true;
      el.playbackRate = 2;
      await el.play();
    });
    await expect(action).not.toHaveAttribute('aria-disabled', 'true', { timeout: 30_000 });
    await action.click();

    await expect(heading('Ready for the quiz?')).toBeVisible();
    await expect(page.getByText(/5 questions · 70% to pass/)).toBeVisible();
    await axeCheck(page, 'quiz intro');
    await startSecureQuiz(page);
    expect(await windowState(s.app)).toMatchObject({ kiosk: true, contentProtected: true });
    await answerQuiz(page, s.backend);
    await submitQuiz(page);
    await expect(heading(/Passed/)).toBeVisible();
    await xpFromResult();
    await expect(page.getByText('First Steps')).toBeVisible();
    await axeCheck(page, 'quiz result');
    await page.getByRole('button', { name: 'Continue' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading')).toContainText(/Badge earned/);
    const { totalXP } = await meXp(s.backend, 'journey');
    if (levelForXp(totalXP) !== 'Apprentice') {
      await expect(dialog.getByRole('heading')).toContainText(/level up/i);
    }
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(heading(DASHBOARD_HEADING)).toBeVisible();
  });

  test('3. Module 2 (interactive): a wrong answer, a failed attempt with review, then a retry that passes', async () => {
    test.setTimeout(150_000);
    // Module 3 is still locked and says why.
    await expect(page.getByText('Pass the Module 2 quiz to unlock').first()).toBeVisible();
    await page.getByRole('button', { name: /^(Start|Resume) module/ }).click();
    await expect(page.getByText('Module 2 of 7')).toBeVisible();
    await practice({ firstWrong: true });
    await expect(heading('Ready for the quiz?')).toBeVisible();
    await startSecureQuiz(page);
    await answerQuiz(page, s.backend, { wrong: 2 });
    await submitQuiz(page);
    await expect(heading(/Not passed/)).toBeVisible();

    await page.getByRole('button', { name: 'Review answers' }).click();
    await expect(heading('Answer review')).toBeVisible();
    // Reveal policy (D3-13): explanations after a fail, never the answer key.
    await expect(page.getByText('Correct answer', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 3 }).first()).toBeVisible();
    await axeCheck(page, 'answer review');
    await page.getByRole('button', { name: /Back to results/ }).click();

    await page.getByRole('button', { name: 'Retry quiz' }).click();
    await expect(heading('Ready for the quiz?')).toBeVisible();
    await startSecureQuiz(page);
    await answerQuiz(page, s.backend);
    await submitQuiz(page);
    await expect(heading(/Passed/)).toBeVisible();
    await xpFromResult();
    await page.getByRole('button', { name: 'Continue' }).click();
    await closeAchievement();
  });

  for (const n of [3, 4, 5]) {
    test(`4.${String(n)} Module ${String(n)}: sidebar unlock and badge count`, async () => {
      test.setTimeout(150_000);
      await passModule();
      const r = await readDashboard(page);
      expect(r.badges).toContain(`Badges (${String(n)} of 7)`);
    });
  }

  for (const n of [6, 7]) {
    test(`5.${String(n)} Module ${String(n)}`, async () => {
      test.setTimeout(150_000);
      await passModule();
      expect((await readDashboard(page)).badges).toContain(`Badges (${String(n)} of 7)`);
    });
  }

  test('6. the dashboard shows real data: XP equals the API and the sum of earned XP; level matches the shared ladder', async () => {
    const r = await readDashboard(page);
    expect(r.modulesDone).toBe('7 of 7 complete');
    expect(r.badges).toContain('Badges (7 of 7)');
    const api = await meXp(s.backend, 'journey');
    expect(r.xp).toBe(api.totalXP);
    const summed = earned.reduce((a, b) => a + b, 0);
    expect(r.xp).toBe(GATE_XP + summed);
    expect(r.level).toBe(api.level);
    expect(r.level).toBe(levelForXp(api.totalXP));
    await expect(page.getByText('All modules complete')).toBeVisible();
    await axeCheck(page, 'dashboard');
  });

  test('7. final assessment: entry from the API, 15 questions under lockdown, pass, training complete', async () => {
    test.setTimeout(150_000);
    await page.getByRole('button', { name: 'Final assessment' }).first().click();
    await expect(heading('Final assessment')).toBeVisible();
    await expect(page.getByText(/15 questions covering every module/)).toBeVisible();
    await expect(page.getByText(/70% to pass/)).toBeVisible();
    await axeCheck(page, 'final assessment entry');
    await page.getByRole('button', { name: 'Start final assessment' }).click();
    await expect(heading('Ready for the quiz?')).toBeVisible();
    await startSecureQuiz(page);
    const count = await answerQuiz(page, s.backend);
    expect(count).toBe(15);
    await submitQuiz(page);
    await expect(heading(/Passed/)).toBeVisible();
    await xpFromResult();
    await page.getByRole('button', { name: 'Continue' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading')).toContainText("You've completed your training");
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(heading(DASHBOARD_HEADING)).toBeVisible();
    await expect(page.getByText(/Completed with \d+%/)).toBeVisible();

    const r = await readDashboard(page);
    const api = await meXp(s.backend, 'journey');
    expect(r.xp).toBe(api.totalXP);
    expect(r.xp).toBe(GATE_XP + earned.reduce((a, b) => a + b, 0));
    expect(r.level).toBe(levelForXp(api.totalXP));
  });

  test('8. relaunch with the same user data: session resumes, no onboarding, values unchanged, Light persists', async () => {
    const before = await readDashboard(page);
    await forceClose(s.app);
    s = await launchApp({ userDataDir });
    page = s.page;
    await expect(heading(DASHBOARD_HEADING)).toBeVisible({ timeout: 30_000 });
    await expect(heading(/Welcome to CSense, /)).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await readDashboard(page)).toEqual(before);
  });
});
