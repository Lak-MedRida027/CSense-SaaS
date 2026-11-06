import { amber, blue, green, indigo, neutral, red } from './primitives';

export const THEME_NAMES = ['dark', 'light'] as const;
/** Dark is the primary theme; light is secondary but must stay AA-complete. */
export type ThemeName = (typeof THEME_NAMES)[number];

/** Semantic status tones (locked): blue = info, green = success, amber = caution, red = critical. */
export const STATUS_TONES = ['info', 'success', 'caution', 'critical'] as const;
export type StatusTone = (typeof STATUS_TONES)[number];

export interface StatusColors {
  /** Text / icon colour on any surface. */
  fg: string;
  /** Tinted background for chips, alerts, feedback panels. */
  subtleBg: string;
  /** Text colour on `subtleBg`. */
  subtleFg: string;
  /** Filled background (solid buttons, solid badges). */
  solid: string;
  /** Text colour on `solid`. */
  onSolid: string;
}

export interface BrandColors {
  primary: string;
  primaryHover: string;
  onPrimary: string;
  /** Translucent tint for selected nav items; text on it stays `text.primary`. */
  subtle: string;
}

export interface SemanticColors {
  surface: { canvas: string; s1: string; s2: string; s3: string };
  text: { primary: string; secondary: string; muted: string; disabled: string; inverse: string };
  border: { subtle: string; strong: string };
  focusRing: string;
  scrim: string;
  status: Record<StatusTone, StatusColors>;
  brand: BrandColors;
}

export const darkColors: SemanticColors = {
  surface: { canvas: neutral[975], s1: neutral[900], s2: neutral[850], s3: neutral[800] },
  text: {
    primary: neutral[100],
    secondary: neutral[300],
    muted: neutral[350],
    disabled: neutral[550],
    inverse: neutral[975],
  },
  border: { subtle: neutral[750], strong: neutral[500] },
  focusRing: indigo[200],
  scrim: 'rgba(4, 6, 10, 0.72)',
  status: {
    info: {
      fg: blue[400],
      subtleBg: blue[900],
      subtleFg: blue[200],
      solid: blue[600],
      onSolid: neutral[0],
    },
    success: {
      fg: green[400],
      subtleBg: green[900],
      subtleFg: green[200],
      solid: green[600],
      onSolid: green[975],
    },
    caution: {
      fg: amber[400],
      subtleBg: amber[900],
      subtleFg: amber[200],
      solid: amber[400],
      onSolid: amber[975],
    },
    critical: {
      fg: red[400],
      subtleBg: red[900],
      subtleFg: red[200],
      solid: red[600],
      onSolid: neutral[0],
    },
  },
  // Neutral CSense brand: monochrome primary, so it can never collide with a status hue.
  brand: {
    primary: neutral[100],
    primaryHover: neutral[0],
    onPrimary: neutral[975],
    subtle: 'rgba(230, 237, 243, 0.10)',
  },
};

export const lightColors: SemanticColors = {
  surface: { canvas: neutral[25], s1: neutral[0], s2: neutral[50], s3: neutral[150] },
  text: {
    primary: neutral[950],
    secondary: neutral[700],
    muted: neutral[600],
    disabled: neutral[400],
    inverse: neutral[0],
  },
  border: { subtle: neutral[200], strong: neutral[450] },
  focusRing: indigo[700],
  scrim: 'rgba(15, 23, 42, 0.48)',
  status: {
    info: {
      fg: blue[700],
      subtleBg: blue[50],
      subtleFg: blue[800],
      solid: blue[600],
      onSolid: neutral[0],
    },
    success: {
      fg: green[750],
      subtleBg: green[50],
      subtleFg: green[800],
      solid: green[700],
      onSolid: neutral[0],
    },
    caution: {
      fg: amber[700],
      subtleBg: amber[50],
      subtleFg: amber[800],
      solid: amber[400],
      onSolid: amber[975],
    },
    critical: {
      fg: red[700],
      subtleBg: red[50],
      subtleFg: red[800],
      solid: red[600],
      onSolid: neutral[0],
    },
  },
  brand: {
    primary: neutral[950],
    primaryHover: neutral[700],
    onPrimary: neutral[0],
    subtle: 'rgba(15, 23, 42, 0.08)',
  },
};

export const semanticColors: Record<ThemeName, SemanticColors> = {
  dark: darkColors,
  light: lightColors,
};
