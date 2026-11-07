/**
 * Five-tier progression ladder (Client Needs FR8), lowest to highest.
 */
export const LEVELS = ['Apprentice', 'Aware', 'Practitioner', 'Guardian', 'Defender'] as const;
export type Level = (typeof LEVELS)[number];

/**
 * Minimum total XP for each level (Phase 4, ADR 0009, decision D4-2). A level is the highest one
 * whose threshold is at or below the employee's total XP.
 */
export const LEVEL_THRESHOLDS: Readonly<Record<Level, number>> = Object.freeze({
  Apprentice: 0,
  Aware: 300,
  Practitioner: 900,
  Guardian: 2000,
  Defender: 3500,
});
