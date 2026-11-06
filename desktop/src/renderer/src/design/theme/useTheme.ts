import { use } from 'react';
import { ThemeContext, type ThemeContextValue } from './ThemeContext';

/** Active theme, preferences, validated brand and the preference setter. */
export function useTheme(): ThemeContextValue {
  return use(ThemeContext);
}
