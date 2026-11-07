import { LEVELS, LEVEL_THRESHOLDS, type Level } from '../constants/levels.js';

function assertXp(xp: number): void {
  if (!Number.isInteger(xp) || xp < 0) throw new RangeError('xp must be a non-negative integer');
}

/** The highest level whose threshold is at or below `xp`. */
export function levelForXp(xp: number): Level {
  assertXp(xp);
  let result: Level = LEVELS[0];
  for (const level of LEVELS) {
    if (xp >= LEVEL_THRESHOLDS[level]) result = level;
  }
  return result;
}

export interface LevelProgress {
  level: Level;
  /** 1 (Apprentice) to 5 (Defender). */
  tier: 1 | 2 | 3 | 4 | 5;
  currentLevelFloorXP: number;
  nextLevel: Level | null;
  nextLevelXP: number | null;
  xpToNextLevel: number | null;
}

/** Exactly what the XP bar and the level ladder need. */
export function levelProgress(xp: number): LevelProgress {
  const level = levelForXp(xp);
  const index = LEVELS.indexOf(level);
  const nextLevel = LEVELS[index + 1] ?? null;
  const nextLevelXP = nextLevel === null ? null : LEVEL_THRESHOLDS[nextLevel];
  return {
    level,
    tier: (index + 1) as LevelProgress['tier'],
    currentLevelFloorXP: LEVEL_THRESHOLDS[level],
    nextLevel,
    nextLevelXP,
    xpToNextLevel: nextLevelXP === null ? null : nextLevelXP - xp,
  };
}
