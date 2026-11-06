import type { Level } from '@csense/shared';
import { fuchsia, indigo, neutral, teal, violet } from './primitives';
import type { ThemeName } from './semantic';

export interface LevelColors {
  /** Text, icon and ring colour. */
  fg: string;
  /** Tinted chip background. */
  subtleBg: string;
}

export interface LevelMeta {
  /** 1-based tier number, always rendered as "L{n}" so level is never colour-only. */
  tier: number;
  /** Number of crest pips (equals tier). */
  pips: number;
  /** Defender also shows a star on its crest. */
  star: boolean;
}

/**
 * Level hues sit in the gaps between the four semantic hues (OKLCH: info 252, success 155,
 * caution 81, critical 23). Defender is fuchsia, not gold, so it never reads as "caution" (D10).
 * Keyed by the shared `Level` type: adding a level in /shared fails typecheck until it has colours.
 */
export const levelColors: Record<ThemeName, Record<Level, LevelColors>> = {
  dark: {
    Apprentice: { fg: neutral[325], subtleBg: neutral[725] },
    Aware: { fg: teal[400], subtleBg: teal[900] },
    Practitioner: { fg: indigo[300], subtleBg: indigo[900] },
    Guardian: { fg: violet[400], subtleBg: violet[900] },
    Defender: { fg: fuchsia[400], subtleBg: fuchsia[900] },
  },
  light: {
    Apprentice: { fg: neutral[590], subtleBg: neutral[150] },
    Aware: { fg: teal[700], subtleBg: teal[50] },
    Practitioner: { fg: indigo[600], subtleBg: indigo[50] },
    Guardian: { fg: violet[700], subtleBg: violet[50] },
    Defender: { fg: fuchsia[700], subtleBg: fuchsia[50] },
  },
};

export const levelMeta: Record<Level, LevelMeta> = {
  Apprentice: { tier: 1, pips: 1, star: false },
  Aware: { tier: 2, pips: 2, star: false },
  Practitioner: { tier: 3, pips: 3, star: false },
  Guardian: { tier: 4, pips: 4, star: false },
  Defender: { tier: 5, pips: 5, star: true },
};
