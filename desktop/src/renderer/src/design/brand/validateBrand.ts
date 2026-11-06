import { LEVELS } from '@csense/shared';
import {
  AA_NON_TEXT,
  AA_TEXT,
  contrastRatio,
  hexToOklch,
  hueDistance,
  isHexColor,
  oklchToHex,
} from '../tokens/contrast';
import { theme, STATUS_TONES, THEME_NAMES, type BrandColors, type ThemeName } from '../tokens';
import { defaultBrand } from './brand.default';
import type { BrandAsset, BrandConfig, ResolvedBrand } from './brand.types';

/** A colour with chroma below this is treated as neutral (no hue to collide). */
export const CHROMA_NEUTRAL_MAX = 0.05;
/** Minimum hue distance from any status hue before a brand colour may drive interactive UI. */
export const STATUS_HUE_MIN_DISTANCE = 30;
/** Hue distance from a level colour that triggers a (non-blocking) warning. */
export const LEVEL_HUE_WARN_DISTANCE = 20;

const DARK_TEXT = theme.color.dark.surface.canvas;
const LIGHT_TEXT = theme.color.light.surface.s1;

const statusHues = STATUS_TONES.map((tone) => ({
  tone,
  hue: hexToOklch(theme.color.dark.status[tone].fg).h,
}));

function isSafeAssetUrl(url: string): boolean {
  if (url.startsWith('data:image/')) return true;
  // Reject absolute remote URLs and protocol-relative URLs; bundled assets are same-origin paths.
  return !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('//');
}

function checkAsset(
  name: string,
  asset: BrandAsset | undefined,
  fallback: BrandAsset | undefined,
  warnings: string[],
): BrandAsset | undefined {
  if (!asset) return fallback;
  if (isSafeAssetUrl(asset.dark) && isSafeAssetUrl(asset.light)) return asset;
  warnings.push(`${name}: remote or non-image URL rejected; logos must be bundled. Using default.`);
  return fallback;
}

/** Shift OKLCH lightness until the colour reaches 3:1 against both reference surfaces. */
function fitToSurfaces(hex: string, themeName: ThemeName): string | undefined {
  const surfaces = theme.color[themeName].surface;
  const passes = (c: string) =>
    contrastRatio(c, surfaces.canvas) >= AA_NON_TEXT &&
    contrastRatio(c, surfaces.s1) >= AA_NON_TEXT;
  const base = hexToOklch(hex);
  const step = themeName === 'dark' ? 0.02 : -0.02;
  for (let i = 0; i <= 40; i += 1) {
    const l = Math.min(0.98, Math.max(0.05, base.l + step * i));
    const candidate = i === 0 ? hex.toUpperCase() : oklchToHex({ ...base, l });
    if (passes(candidate)) return candidate;
  }
  return undefined;
}

function onColorFor(bg: string): string | undefined {
  const dark = contrastRatio(DARK_TEXT, bg);
  const light = contrastRatio(LIGHT_TEXT, bg);
  const best = dark >= light ? DARK_TEXT : LIGHT_TEXT;
  return Math.max(dark, light) >= AA_TEXT ? best : undefined;
}

function hoverOf(hex: string, themeName: ThemeName, onPrimary: string): string {
  const base = hexToOklch(hex);
  const delta = themeName === 'dark' ? 0.06 : -0.06;
  const hover = oklchToHex({ ...base, l: Math.min(0.98, Math.max(0.05, base.l + delta)) });
  return contrastRatio(onPrimary, hover) >= AA_TEXT ? hover : hex;
}

function subtleOf(hex: string): string {
  return `color-mix(in srgb, ${hex} 16%, transparent)`;
}

/**
 * Apply the brand guardrails (docs/design/brand.md):
 * 1. Primary must reach 3:1 on canvas and surface-1 (lightness is adjusted per theme to get there),
 *    and an on-colour must reach 4.5:1 on it.
 * 2. A chromatic primary within 30 degrees of a status hue is demoted to decorative-only.
 * 3. Proximity to a level hue only warns (levels always carry numerals and pips).
 * 4. Invalid input never throws: it falls back to the neutral default with a warning.
 */
export function validateBrand(input: BrandConfig | undefined): ResolvedBrand {
  const warnings: string[] = [];
  const cfg = input ?? defaultBrand;

  const appName = cfg.appName.trim() || defaultBrand.appName;
  if (appName !== cfg.appName) warnings.push('appName was empty; using the default.');

  const resolved: ResolvedBrand = {
    appName,
    orgName: cfg.orgName?.trim() || undefined,
    logoMark: checkAsset('logoMark', cfg.logoMark, defaultBrand.logoMark, warnings),
    logoWordmark: checkAsset('logoWordmark', cfg.logoWordmark, defaultBrand.logoWordmark, warnings),
    colorMode: 'neutral',
    primary: undefined,
    accent: undefined,
    warnings,
  };

  const accent = cfg.colors?.accent;
  if (accent !== undefined) {
    if (isHexColor(accent)) resolved.accent = accent.toUpperCase();
    else warnings.push(`colors.accent "${accent}" is not a hex colour; ignored.`);
  }

  const primary = cfg.colors?.primary;
  if (primary === undefined) return resolved;
  if (!isHexColor(primary)) {
    warnings.push(`colors.primary "${primary}" is not a hex colour; using the neutral primary.`);
    return resolved;
  }

  const { c, h } = hexToOklch(primary);
  if (c >= CHROMA_NEUTRAL_MAX) {
    const clash = statusHues.find((s) => hueDistance(h, s.hue) < STATUS_HUE_MIN_DISTANCE);
    if (clash) {
      warnings.push(
        `colors.primary ${primary} is within ${STATUS_HUE_MIN_DISTANCE} degrees of the ${clash.tone} status hue; ` +
          'using it for logo/splash only (decorative mode).',
      );
      resolved.colorMode = 'decorative';
      resolved.accent ??= primary.toUpperCase();
      return resolved;
    }
    for (const level of LEVELS) {
      const lh = hexToOklch(theme.level.dark[level].fg).h;
      if (hueDistance(h, lh) < LEVEL_HUE_WARN_DISTANCE) {
        warnings.push(`colors.primary ${primary} is close to the ${level} level colour.`);
      }
    }
  }

  const perTheme = {} as Record<ThemeName, BrandColors>;
  for (const name of THEME_NAMES) {
    const fitted = fitToSurfaces(primary, name);
    const onPrimary = fitted ? onColorFor(fitted) : undefined;
    if (!fitted || !onPrimary) {
      warnings.push(
        `colors.primary ${primary} cannot meet contrast in the ${name} theme; using the neutral primary.`,
      );
      return resolved;
    }
    if (fitted !== primary.toUpperCase()) {
      warnings.push(`colors.primary adjusted to ${fitted} in the ${name} theme for 3:1 contrast.`);
    }
    perTheme[name] = {
      primary: fitted,
      primaryHover: hoverOf(fitted, name, onPrimary),
      onPrimary,
      subtle: subtleOf(fitted),
    };
  }
  resolved.primary = perTheme;
  resolved.colorMode = 'interactive';
  return resolved;
}
