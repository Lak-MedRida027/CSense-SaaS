import { expect } from 'vitest';
import { axe } from 'vitest-axe';

/**
 * Run axe-core (WCAG 2.0/2.1 A + AA rules) against a rendered container. Colour contrast is
 * disabled here because jsdom does not compute styles; contrast is verified from the tokens
 * (tokens.test.ts) and by the Playwright a11y spec in a real browser.
 */
export async function expectNoA11yViolations(container: Element): Promise<void> {
  const results = await axe(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.help} -> ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    ),
  ).toEqual([]);
}
