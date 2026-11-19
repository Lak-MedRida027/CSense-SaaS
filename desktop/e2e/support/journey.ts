/// <reference lib="dom" />
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
// The shared package is ESM-only (`exports` has no `require` condition) and Playwright loads specs as
// CommonJS, so reach the built module by path (Node loads ESM through require).
import { levelForXp } from '../../../shared/dist/gamification/levels.js';
import { api, loginHttp } from './backend';
import type { BackendInfo } from './backendProcess';
import { answerCorrectly, signIn } from './keys';

export { levelForXp };

/** The dashboard h1: "Welcome, <name>" on a first run, "Good to see you, <name>" afterwards. */
export const DASHBOARD_HEADING = /^(Welcome|Good to see you), /;

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** axe (legacy mode: the default opens a blank page, which Electron does not support). */
export async function axeCheck(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).setLegacyMode(true).analyze();
  const summary = results.violations.map(
    (v) =>
      `${label} :: ${v.id} (${v.impact ?? 'n/a'}): ${v.help} -> ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
  expect(summary).toEqual([]);
}

/** Signs in and gets through the gate: answers if challenged, presses Continue now. */
export async function passGate(
  page: Page,
  b: BackendInfo,
  who: keyof BackendInfo['accounts'],
): Promise<void> {
  const acct = b.accounts[who];
  await signIn(page, acct.email, acct.password);
  const challenge = page.getByRole('heading', { level: 1, name: 'Security check' });
  const granted = page.getByRole('heading', { level: 1, name: 'Access granted' });
  await expect(challenge.or(granted)).toBeVisible({ timeout: 20_000 });
  if (await challenge.isVisible()) {
    await answerCorrectly(page, b);
    await expect(granted).toBeVisible();
  }
  await page.getByRole('button', { name: /Continue now/ }).click();
}

/** The question stems currently shown inside the quiz. */
async function stem(page: Page): Promise<string> {
  return (await page.locator('legend').first().innerText()).trim();
}

async function pickOption(page: Page, index: number): Promise<void> {
  await page.getByRole('radio').nth(index).check({ force: true });
}

/**
 * Answers every question of the running quiz or final assessment using the harness key. `wrong` is
 * the number of questions to answer incorrectly (the first ones). Returns when the review screen is
 * showing; the caller submits.
 */
export async function answerQuiz(
  page: Page,
  b: BackendInfo,
  opts: { wrong?: number } = {},
): Promise<number> {
  let wrongLeft = opts.wrong ?? 0;
  let answered = 0;
  for (let i = 0; i < 40; i++) {
    const text = await stem(page);
    const correct = b.quizKey[text];
    if (correct === undefined) throw new Error(`no harness key for question: ${text}`);
    const options = await page.getByRole('radio').count();
    const index = wrongLeft > 0 ? (correct + 1) % options : correct;
    if (wrongLeft > 0) wrongLeft--;
    await pickOption(page, index);
    answered++;
    const next = page.getByRole('button', { name: /Next question/ });
    if (await next.isVisible()) await next.click();
    else break;
  }
  await page.getByRole('button', { name: /Review and submit/ }).click();
  return answered;
}

export async function submitQuiz(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Submit/ }).click();
}

/** From the dashboard: open the next module and get to its quiz intro (lesson is read via the transcript). */
export async function openModuleQuiz(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^(Start|Resume) module/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(DASHBOARD_HEADING);
  await finishLesson(page);
  await page.getByRole('button', { name: 'Continue to quiz' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ready for the quiz?' })).toBeVisible();
}

/** Video modules: open the transcript and scroll it to the end (the accessible alternative path). */
export async function finishLesson(page: Page): Promise<void> {
  // The lesson action is always rendered once the module has loaded.
  await expect(page.getByRole('button', { name: /^Continue to (practice|quiz)$/ })).toBeVisible();
  const show = page.getByRole('button', { name: 'Show transcript' });
  if ((await show.count()) > 0) {
    await show.click();
    await page.getByRole('region', { name: 'Transcript' }).evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event('scroll'));
    });
  }
}

export async function startSecureQuiz(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start secure quiz' }).click();
  await expect(
    page.getByRole('region', { name: 'Secure quiz mode' }).getByText('Secure quiz mode is on'),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('radio').first()).toBeAttached();
}

/** After a result: leave it and get back to the dashboard (a pass goes there directly). */
export async function backToDashboard(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: /^(Back to module|Back to final assessment|Continue)$/ })
    .click();
  const dashboard = page.getByRole('heading', { level: 1, name: DASHBOARD_HEADING });
  const sidebar = page.getByRole('button', { name: 'Dashboard' }).first();
  await expect(dashboard.or(sidebar)).toBeVisible();
  if (!(await dashboard.isVisible())) await sidebar.click();
  await expect(dashboard).toBeVisible();
}

export interface DashboardReading {
  xp: number;
  level: string;
  modulesDone: string;
  badges: string;
}

/** Reads the real values the dashboard shows. */
export async function readDashboard(page: Page): Promise<DashboardReading> {
  const ring = page.getByRole('progressbar', { name: 'Progress to next level' });
  const xpText = (await ring.getAttribute('aria-valuetext')) ?? '';
  const xp = Number(xpText.replace(/[^\d]/g, ''));
  const level = (await page.locator('[data-level]').first().getAttribute('data-level')) ?? '';
  const modulesDone =
    (await page
      .getByRole('progressbar', { name: 'Modules complete' })
      .getAttribute('aria-valuetext')) ?? '';
  const badgeTitle = await page.getByText(/^Badges \(\d+ of \d+\)$/).innerText();
  return { xp, level, modulesDone, badges: badgeTitle };
}

export async function meXp(
  b: BackendInfo,
  who: keyof BackendInfo['accounts'],
): Promise<{ totalXP: number; level: string }> {
  const token = await loginHttp(b, who);
  const r = await api<{ totalXP: number; level: string }>(b, 'GET', '/me/xp', { token });
  return r.body;
}

export async function onboardingState(
  b: BackendInfo,
  who: keyof BackendInfo['accounts'],
): Promise<{ outcome: string; at: string } | null> {
  const token = await loginHttp(b, who);
  const r = await api<{ onboarding: { outcome: string; at: string } | null }>(
    b,
    'GET',
    '/auth/me',
    { token },
  );
  return r.body.onboarding;
}
