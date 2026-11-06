import { describe, expect, it } from 'vitest';
import { AA_NON_TEXT, AA_TEXT, contrastRatio } from '../tokens/contrast';
import { theme, THEME_NAMES } from '../tokens';
import { defaultBrand } from './brand.default';
import { validateBrand } from './validateBrand';

describe('validateBrand', () => {
  it('returns the neutral CSense brand by default', () => {
    const b = validateBrand(undefined);
    expect(b.appName).toBe('CSense');
    expect(b.colorMode).toBe('neutral');
    expect(b.primary).toBeUndefined();
    expect(b.warnings).toEqual([]);
    expect(b.logoMark).toEqual(defaultBrand.logoMark);
  });

  it('accepts a purple primary (clear of every status hue) as interactive', () => {
    const b = validateBrand({ appName: 'Acme Shield', colors: { primary: '#7B3FA0' } });
    expect(b.colorMode).toBe('interactive');
    for (const name of THEME_NAMES) {
      const p = b.primary?.[name];
      expect(p).toBeDefined();
      if (!p) continue;
      const s = theme.color[name].surface;
      expect(contrastRatio(p.primary, s.canvas)).toBeGreaterThanOrEqual(AA_NON_TEXT);
      expect(contrastRatio(p.primary, s.s1)).toBeGreaterThanOrEqual(AA_NON_TEXT);
      expect(contrastRatio(p.onPrimary, p.primary)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(p.onPrimary, p.primaryHover)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it.each([
    ['blue (info)', '#1D4ED8'],
    ['green (success)', '#16A34A'],
    ['amber (caution)', '#D97706'],
    ['red (critical)', '#DC2626'],
  ])('demotes a %s primary to decorative-only', (_label, hex) => {
    const b = validateBrand({ appName: 'Client', colors: { primary: hex } });
    expect(b.colorMode).toBe('decorative');
    expect(b.primary).toBeUndefined();
    expect(b.accent).toBe(hex.toUpperCase());
    expect(b.warnings.join(' ')).toMatch(/decorative mode/);
  });

  it('treats a near-grey primary as neutral-hued and fits it to contrast', () => {
    const b = validateBrand({ appName: 'Grey Co', colors: { primary: '#2B2B2B' } });
    expect(b.colorMode).toBe('interactive');
    const dark = b.primary?.dark.primary ?? '#000000';
    expect(contrastRatio(dark, theme.color.dark.surface.canvas)).toBeGreaterThanOrEqual(3);
    expect(b.warnings.some((w) => w.includes('adjusted'))).toBe(true);
  });

  it('falls back on an invalid colour without throwing', () => {
    const b = validateBrand({ appName: 'X', colors: { primary: 'not-a-colour', accent: 'red' } });
    expect(b.colorMode).toBe('neutral');
    expect(b.accent).toBeUndefined();
    expect(b.warnings).toHaveLength(2);
  });

  it('rejects remote logo URLs and keeps the default', () => {
    const b = validateBrand({
      appName: 'X',
      logoMark: { dark: 'https://evil.example/logo.svg', light: '/logo.svg' },
    });
    expect(b.logoMark).toEqual(defaultBrand.logoMark);
    expect(b.warnings[0]).toMatch(/remote/);
  });

  it('accepts data: image URIs and bundled paths', () => {
    const asset = { dark: 'data:image/svg+xml;base64,AAAA', light: '/assets/logo-light.svg' };
    expect(validateBrand({ appName: 'X', logoMark: asset }).logoMark).toEqual(asset);
  });

  it('restores an empty app name', () => {
    expect(validateBrand({ appName: '   ' }).appName).toBe('CSense');
  });
});
