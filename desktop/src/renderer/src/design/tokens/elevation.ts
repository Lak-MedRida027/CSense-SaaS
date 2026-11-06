import type { ThemeName } from './semantic';

export const ELEVATION_LEVELS = ['e0', 'e1', 'e2', 'e3', 'e4'] as const;
export type ElevationLevel = (typeof ELEVATION_LEVELS)[number];

/**
 * In dark mode depth comes mostly from surface steps + a border; shadows are soft support.
 * Light mode leans on shadow more.
 */
export const shadow: Record<ThemeName, Record<ElevationLevel, string>> = {
  dark: {
    e0: 'none',
    e1: '0 1px 2px rgba(0, 0, 0, 0.4)',
    e2: '0 4px 12px rgba(0, 0, 0, 0.45)',
    e3: '0 12px 32px rgba(0, 0, 0, 0.55)',
    e4: '0 16px 40px rgba(0, 0, 0, 0.6)',
  },
  light: {
    e0: 'none',
    e1: '0 1px 2px rgba(15, 23, 42, 0.08), 0 1px 3px rgba(15, 23, 42, 0.06)',
    e2: '0 4px 12px rgba(15, 23, 42, 0.12)',
    e3: '0 12px 32px rgba(15, 23, 42, 0.18)',
    e4: '0 16px 40px rgba(15, 23, 42, 0.2)',
  },
};

export const zIndex = {
  base: '0',
  sticky: '100',
  dropdown: '200',
  overlay: '300',
  modal: '400',
  toast: '500',
  lockdownBanner: '900',
} as const;
