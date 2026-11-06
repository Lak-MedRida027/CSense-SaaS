import { shadow, zIndex } from './elevation';
import { levelColors, levelMeta } from './levels';
import { duration, easing, motionScale, reducedDuration, reducedMotionScale } from './motion';
import { riskTokens } from './risk';
import { semanticColors } from './semantic';
import { radius, size, space } from './spacing';
import { fontFamily, fontWeight, letterSpacing, typeScale } from './typography';

/**
 * The single source of truth for CSense design tokens. `toCss(theme)` turns this into
 * `tokens.generated.css`; components consume the CSS variables, and JS reads this object only
 * where it needs a raw value (charts, Electron window background).
 */
export const theme = {
  color: semanticColors,
  level: levelColors,
  levelMeta,
  risk: riskTokens,
  font: { family: fontFamily, scale: typeScale, weight: fontWeight, letterSpacing },
  space,
  size,
  radius,
  shadow,
  zIndex,
  motion: {
    duration,
    reducedDuration,
    easing,
    scale: motionScale,
    reducedScale: reducedMotionScale,
  },
} as const;

export type Theme = typeof theme;

export { THEME_NAMES, STATUS_TONES } from './semantic';
export type { ThemeName, StatusTone, StatusColors, SemanticColors, BrandColors } from './semantic';
export type { LevelColors, LevelMeta } from './levels';
export type { RiskToken, RiskIconName } from './risk';
export type { TypeStepName } from './typography';
export type { ElevationLevel } from './elevation';
export type { DurationName } from './motion';
