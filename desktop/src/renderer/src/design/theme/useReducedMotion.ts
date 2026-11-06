import { useTheme } from './useTheme';

/**
 * True when motion should be reduced: the OS `prefers-reduced-motion` setting (when the in-app
 * preference is "system") or an explicit in-app "reduced" choice. Use it for JS-driven animation;
 * CSS durations already collapse via the generated tokens.
 */
export function useReducedMotion(): boolean {
  return useTheme().reducedMotion;
}
