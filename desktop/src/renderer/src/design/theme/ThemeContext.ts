import { createContext } from 'react';
import type { ResolvedBrand } from '../brand/brand.types';
import { validateBrand } from '../brand/validateBrand';
import type { ThemeName } from '../tokens';

/** Dark is the default regardless of OS setting (D13); "system" follows prefers-color-scheme. */
export type ThemePreference = ThemeName | 'system';
/** "system" follows prefers-reduced-motion; "reduced"/"full" are explicit in-app overrides. */
export type MotionPreference = 'system' | 'reduced' | 'full';
/** Onboarding "text size" preference; scales the rem-based type and spacing. */
export type TextSizePreference = 'default' | 'large' | 'larger';

export interface DisplayPreferences {
  theme: ThemePreference;
  motion: MotionPreference;
  textSize: TextSizePreference;
}

export const DEFAULT_PREFERENCES: DisplayPreferences = {
  theme: 'dark',
  motion: 'system',
  textSize: 'default',
};

export interface ThemeContextValue {
  preferences: DisplayPreferences;
  resolvedTheme: ThemeName;
  /** True when motion should be reduced (OS setting or in-app override). */
  reducedMotion: boolean;
  brand: ResolvedBrand;
  setPreferences: (next: Partial<DisplayPreferences>) => void;
}

export const ThemeContext = createContext<ThemeContextValue>({
  preferences: DEFAULT_PREFERENCES,
  resolvedTheme: 'dark',
  reducedMotion: false,
  brand: validateBrand(undefined),
  setPreferences: () => undefined,
});
