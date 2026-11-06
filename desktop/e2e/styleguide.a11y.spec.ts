/// <reference lib="dom" />
import AxeBuilder from '@axe-core/playwright';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

/**
 * Design-system accessibility gate: axe (WCAG 2.0/2.1 A + AA, including colour contrast in a real
 * Chromium) on the styleguide and every screen fixture, in dark and light, plus keyboard and
 * reduced-motion checks.
 *
 * The styleguide is dev-only. Build with `npm run build:styleguide` (electron-vite --mode
 * styleguide) first; against a normal production build these tests skip, unless
 * CSENSE_REQUIRE_STYLEGUIDE=1 is set (CI), in which case they fail.
 */
let app: ElectronApplication;
let page: Page;
let styleguideAvailable = false;

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function goto(hash: string): Promise<void> {
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
}

async function expectNoViolations(label: string): Promise<void> {
  // Legacy mode runs axe in-page; the default opens a blank page, which Electron does not support.
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).setLegacyMode(true).analyze();
  const summary = results.violations.map(
    (v) =>
      `${label} :: ${v.id} (${v.impact ?? 'n/a'}): ${v.help} -> ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
  expect(summary).toEqual([]);
}

test.beforeAll(async () => {
  app = await electron.launch({ args: ['out/main/index.js'] });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await goto('#/styleguide/tokens');
  styleguideAvailable = await page
    .getByRole('heading', { level: 1, name: 'Tokens' })
    .waitFor({ timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  // The CI accessibility step sets this so a build without the styleguide fails instead of skipping.
  if (process.env.CSENSE_REQUIRE_STYLEGUIDE === '1') {
    expect(
      styleguideAvailable,
      'CSENSE_REQUIRE_STYLEGUIDE=1 but the styleguide is not in this build (run `npm run build:styleguide`).',
    ).toBe(true);
  }
});

test.afterAll(async () => {
  await app.close();
});

test.beforeEach(() => {
  test.skip(
    !styleguideAvailable,
    'Styleguide not in this build: run `npm run build:styleguide` first.',
  );
});

for (const theme of ['dark', 'light'] as const) {
  test(`styleguide pages have no axe violations (${theme})`, async () => {
    for (const section of ['tokens', 'components', 'screens']) {
      await goto(`#/styleguide/${section}?theme=${theme}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expectNoViolations(`${theme} styleguide/${section}`);
    }
  });

  test(`every screen fixture has no axe violations (${theme})`, async () => {
    await goto(`#/styleguide/screens?theme=${theme}`);
    const hrefs = await page
      .locator('a[href^="#/preview/"]')
      .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));
    expect(hrefs.length).toBeGreaterThanOrEqual(7);
    for (const href of hrefs) {
      await goto(`${href}?theme=${theme}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expectNoViolations(`${theme} ${href}`);
    }
  });
}

test('login is fully keyboard operable with a visible focus ring', async () => {
  await goto('#/preview/login/idle?theme=dark');
  const email = page.getByLabel('Work email');
  await email.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: false }).first()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Show password' })).toBeFocused();
  await page.keyboard.press('Tab');
  const signIn = page.getByRole('button', { name: 'Sign in' });
  await expect(signIn).toBeFocused();
  const outline = await signIn.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).toBe('solid');
  const box = await signIn.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test('quiz exit is reachable by keyboard while lockdown is active', async () => {
  await goto('#/preview/quiz/active?theme=dark');
  const exit = page.getByRole('button', { name: 'Exit quiz' });
  await exit.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog', { name: 'Leave the quiz?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Keep going' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('reduced motion collapses motion tokens', async () => {
  await goto('#/styleguide/tokens?motion=reduced');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  const slow = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--cs-duration-slow').trim(),
  );
  expect(slow).toBe('0.01ms');
});
