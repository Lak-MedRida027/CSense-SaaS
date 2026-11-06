import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import type { BrandConfig } from '../brand/brand.types';
import { validateBrand } from '../brand/validateBrand';
import { cssVarName } from '../tokens/toCss';
import type { ThemeName } from '../tokens';
import {
  DEFAULT_PREFERENCES,
  ThemeContext,
  type DisplayPreferences,
  type ThemeContextValue,
} from './ThemeContext';
import { useMediaQuery } from './useMediaQuery';

export interface ThemeProviderProps {
  children: ReactNode;
  /** Initial preferences (engineers load these from storage later). */
  initialPreferences?: Partial<DisplayPreferences> | undefined;
  /** Client brand; omitted means the neutral CSense brand. Validated before use. */
  brand?: BrandConfig | undefined;
  /** Seam: called when the user changes a display preference, so it can be persisted. */
  onPreferencesChange?: ((prefs: DisplayPreferences) => void) | undefined;
  /** Element that receives data-theme / data-motion / brand vars. Defaults to <html>. */
  target?: HTMLElement | undefined;
}

const BRAND_KEYS = ['primary', 'primaryHover', 'onPrimary', 'subtle'] as const;

/**
 * Applies the active theme, motion and text-size preferences and the validated brand to the
 * document. Presentational only: it never reads or writes storage itself.
 */
export function ThemeProvider({
  children,
  initialPreferences,
  brand,
  onPreferencesChange,
  target,
}: ThemeProviderProps) {
  const [preferences, setPrefsState] = useState<DisplayPreferences>({
    ...DEFAULT_PREFERENCES,
    ...initialPreferences,
  });
  const systemLight = useMediaQuery('(prefers-color-scheme: light)');
  const systemReduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const resolvedBrand = useMemo(() => validateBrand(brand), [brand]);

  const resolvedTheme: ThemeName =
    preferences.theme === 'system' ? (systemLight ? 'light' : 'dark') : preferences.theme;
  const reducedMotion =
    preferences.motion === 'reduced' || (preferences.motion === 'system' && systemReduced);

  const setPreferences = useCallback(
    (next: Partial<DisplayPreferences>) => {
      setPrefsState((prev) => {
        const merged = { ...prev, ...next };
        onPreferencesChange?.(merged);
        return merged;
      });
    },
    [onPreferencesChange],
  );

  useLayoutEffect(() => {
    const el = target ?? document.documentElement;
    el.setAttribute('data-theme', resolvedTheme);
    el.setAttribute('data-motion', preferences.motion === 'system' ? 'system' : preferences.motion);
    el.setAttribute('data-text-size', preferences.textSize);
    const brandColors = resolvedBrand.primary?.[resolvedTheme];
    for (const key of BRAND_KEYS) {
      const name = cssVarName('color', 'brand', key);
      if (brandColors) el.style.setProperty(name, brandColors[key]);
      else el.style.removeProperty(name);
    }
    if (resolvedBrand.accent)
      el.style.setProperty(cssVarName('color', 'brand', 'accent'), resolvedBrand.accent);
    else el.style.removeProperty(cssVarName('color', 'brand', 'accent'));
  }, [target, resolvedTheme, preferences.motion, preferences.textSize, resolvedBrand]);

  useLayoutEffect(() => {
    document.title = resolvedBrand.appName;
    if (import.meta.env.DEV) {
      for (const warning of resolvedBrand.warnings) console.warn(`[CSense brand] ${warning}`);
    }
  }, [resolvedBrand]);

  const value = useMemo<ThemeContextValue>(
    () => ({ preferences, resolvedTheme, reducedMotion, brand: resolvedBrand, setPreferences }),
    [preferences, resolvedTheme, reducedMotion, resolvedBrand, setPreferences],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}
