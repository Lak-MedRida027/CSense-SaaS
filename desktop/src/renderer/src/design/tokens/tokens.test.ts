import { LEVELS, RISK_LEVELS } from '@csense/shared';
import { describe, expect, it } from 'vitest';
import {
  AA_NON_TEXT,
  AA_TEXT,
  contrastRatio,
  hexToOklch,
  hueDistance,
  oklchToHex,
} from './contrast';
import { theme } from './index';
import { STATUS_TONES, THEME_NAMES } from './semantic';
import { toCss } from './toCss';

describe('generated CSS', () => {
  it('tokens.generated.css matches the TS source (run `npx vitest -u` after editing tokens)', async () => {
    await expect(toCss(theme)).toMatchFileSnapshot('./tokens.generated.css');
  });

  it('emits a dark default and a light override', () => {
    const css = toCss(theme);
    expect(css).toContain(":root,\n:root[data-theme='dark']");
    expect(css).toContain(":root[data-theme='light']");
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('aliases every risk band to its status tone', () => {
    const css = toCss(theme);
    expect(css).toContain('--cs-color-risk-low-fg: var(--cs-color-status-success-fg);');
    expect(css).toContain('--cs-color-risk-medium-fg: var(--cs-color-status-caution-fg);');
    expect(css).toContain('--cs-color-risk-high-fg: var(--cs-color-status-critical-fg);');
  });
});

describe('risk bands (locked: Low=Green, Medium=Amber, High=Red)', () => {
  it('maps bands to tones and distinct icons', () => {
    expect(theme.risk.Low.tone).toBe('success');
    expect(theme.risk.Medium.tone).toBe('caution');
    expect(theme.risk.High.tone).toBe('critical');
    const icons = new Set(RISK_LEVELS.map((r) => theme.risk[r].icon));
    expect(icons.size).toBe(RISK_LEVELS.length);
  });
});

describe.each(THEME_NAMES)('WCAG 2.1 AA contrast: %s theme', (name) => {
  const c = theme.color[name];
  const surfaces = Object.entries(c.surface);

  const expectAtLeast = (fg: string, bg: string, min: number, label: string) => {
    const ratio = contrastRatio(fg, bg);
    expect(ratio, `${label}: ${fg} on ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min);
  };

  it.each(['primary', 'secondary', 'muted'] as const)('text-%s on every surface >= 4.5', (role) => {
    for (const [s, bg] of surfaces) expectAtLeast(c.text[role], bg, AA_TEXT, `text-${role}/${s}`);
  });

  it('border-strong and focus ring on every surface >= 3', () => {
    for (const [s, bg] of surfaces) {
      expectAtLeast(c.border.strong, bg, AA_NON_TEXT, `border-strong/${s}`);
      expectAtLeast(c.focusRing, bg, AA_NON_TEXT, `focus-ring/${s}`);
    }
  });

  it.each(STATUS_TONES)('status %s: fg, subtle and solid pairs', (tone) => {
    const st = c.status[tone];
    for (const [s, bg] of surfaces) expectAtLeast(st.fg, bg, AA_TEXT, `${tone}-fg/${s}`);
    expectAtLeast(st.subtleFg, st.subtleBg, AA_TEXT, `${tone}-subtle`);
    expectAtLeast(c.text.primary, st.subtleBg, AA_TEXT, `text-primary/${tone}-subtle-bg`);
    expectAtLeast(st.onSolid, st.solid, AA_TEXT, `${tone}-solid`);
  });

  it('brand primary button', () => {
    expectAtLeast(c.brand.onPrimary, c.brand.primary, AA_TEXT, 'on-primary');
    expectAtLeast(c.brand.onPrimary, c.brand.primaryHover, AA_TEXT, 'on-primary-hover');
    expectAtLeast(c.brand.primary, c.surface.canvas, AA_NON_TEXT, 'primary/canvas');
    expectAtLeast(c.brand.primary, c.surface.s1, AA_NON_TEXT, 'primary/s1');
  });

  it.each(LEVELS)('level %s: fg on every surface and on its chip', (level) => {
    const lv = theme.level[name][level];
    for (const [s, bg] of surfaces) expectAtLeast(lv.fg, bg, AA_TEXT, `${level}/${s}`);
    expectAtLeast(lv.fg, lv.subtleBg, AA_TEXT, `${level}/chip`);
  });
});

describe('hue separation', () => {
  const statusHues = STATUS_TONES.map((t) => hexToOklch(theme.color.dark.status[t].fg).h);

  it('status hues are at least 50 degrees apart (amber-red is the closest pair, ~58)', () => {
    for (let i = 0; i < statusHues.length; i += 1) {
      for (let j = i + 1; j < statusHues.length; j += 1) {
        expect(hueDistance(statusHues[i] ?? 0, statusHues[j] ?? 0)).toBeGreaterThanOrEqual(50);
      }
    }
  });

  it.each(LEVELS)('chromatic level %s keeps >= 25 degrees from every status hue', (level) => {
    const { c, h } = hexToOklch(theme.level.dark[level].fg);
    if (c < 0.05) return; // Apprentice is neutral slate.
    for (const sh of statusHues) expect(hueDistance(h, sh)).toBeGreaterThanOrEqual(25);
  });
});

describe('contrast helpers', () => {
  it('computes known WCAG ratios', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777', '#777')).toBeCloseTo(1, 5);
  });

  it('round-trips through OKLCH', () => {
    for (const hex of ['#5AA9FF', '#3FCB7E', '#F5B83D', '#FF6B6B', '#0B0F17']) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    }
  });
});
