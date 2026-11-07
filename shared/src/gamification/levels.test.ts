import { describe, expect, it } from 'vitest';
import { LEVELS, LEVEL_THRESHOLDS } from '../constants/levels.js';
import { levelForXp, levelProgress } from './levels.js';

describe('levels', () => {
  it('LV1: thresholds are 0 / 300 / 900 / 2000 / 3500, ordered, increasing and frozen', () => {
    expect(LEVEL_THRESHOLDS).toStrictEqual({
      Apprentice: 0,
      Aware: 300,
      Practitioner: 900,
      Guardian: 2000,
      Defender: 3500,
    });
    expect(Object.keys(LEVEL_THRESHOLDS)).toStrictEqual([...LEVELS]);
    const values = LEVELS.map((l) => LEVEL_THRESHOLDS[l]);
    expect(values[0]).toBe(0);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i] ?? 0).toBeGreaterThan(values[i - 1] ?? 0);
    }
    expect(Object.isFrozen(LEVEL_THRESHOLDS)).toBe(true);
  });

  it('LV2: boundaries', () => {
    expect([0, 299].map(levelForXp)).toStrictEqual(['Apprentice', 'Apprentice']);
    expect([300, 899].map(levelForXp)).toStrictEqual(['Aware', 'Aware']);
    expect([900, 1999].map(levelForXp)).toStrictEqual(['Practitioner', 'Practitioner']);
    expect([2000, 3499].map(levelForXp)).toStrictEqual(['Guardian', 'Guardian']);
    expect([3500, 1_000_000].map(levelForXp)).toStrictEqual(['Defender', 'Defender']);
  });

  it('LV3: negative, fractional and NaN xp throw', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => levelForXp(bad)).toThrow(RangeError);
      expect(() => levelProgress(bad)).toThrow(RangeError);
    }
  });

  it('LV4: levelProgress gives what the XP bar needs', () => {
    expect(levelProgress(1240)).toStrictEqual({
      level: 'Practitioner',
      tier: 3,
      currentLevelFloorXP: 900,
      nextLevel: 'Guardian',
      nextLevelXP: 2000,
      xpToNextLevel: 760,
    });
    expect(levelProgress(4100)).toStrictEqual({
      level: 'Defender',
      tier: 5,
      currentLevelFloorXP: 3500,
      nextLevel: null,
      nextLevelXP: null,
      xpToNextLevel: null,
    });
    expect(levelProgress(0).tier).toBe(1);
    expect(levelProgress(300).xpToNextLevel).toBe(600);
  });
});
