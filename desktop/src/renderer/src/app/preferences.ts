/**
 * Display preferences persistence (plan 6, D6-2). The only renderer storage CSense uses:
 * `localStorage['csense.ui.v1'] = { v: 1, prefs: { theme, motion, textSize } }`, validated on read.
 * Anything unknown, corrupt or from another version falls back to the defaults. Nothing else, and
 * certainly no token or learning data, is ever written.
 */
import { DEFAULT_PREFERENCES, type DisplayPreferences } from '../design/theme/ThemeContext';

export const PREFERENCES_KEY = 'csense.ui.v1';

const THEMES = ['dark', 'light', 'system'] as const;
const MOTIONS = ['system', 'reduced', 'full'] as const;
const TEXT_SIZES = ['default', 'large', 'larger'] as const;

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function loadPreferences(storage: PreferenceStorage | null): DisplayPreferences {
  if (!storage) return DEFAULT_PREFERENCES;
  try {
    const raw = storage.getItem(PREFERENCES_KEY);
    if (raw === null) return DEFAULT_PREFERENCES;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_PREFERENCES;
    const { v, prefs } = parsed as { v?: unknown; prefs?: unknown };
    if (v !== 1 || typeof prefs !== 'object' || prefs === null) return DEFAULT_PREFERENCES;
    const p = prefs as Record<string, unknown>;
    return {
      theme: pick(p.theme, THEMES, DEFAULT_PREFERENCES.theme),
      motion: pick(p.motion, MOTIONS, DEFAULT_PREFERENCES.motion),
      textSize: pick(p.textSize, TEXT_SIZES, DEFAULT_PREFERENCES.textSize),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(
  storage: PreferenceStorage | null,
  prefs: DisplayPreferences,
): void {
  if (!storage) return;
  try {
    const { theme, motion, textSize } = prefs;
    storage.setItem(PREFERENCES_KEY, JSON.stringify({ v: 1, prefs: { theme, motion, textSize } }));
  } catch {
    // Storage can be full or blocked; preferences are a convenience, never a requirement.
  }
}

/** `window.localStorage`, or null where it is unavailable. */
export function browserStorage(): PreferenceStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
