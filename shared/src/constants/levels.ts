/**
 * Five-tier progression ladder (Client Needs FR8), lowest to highest.
 * XP thresholds per level are an open decision (U8) and are added in Phase 4.
 */
export const LEVELS = ['Apprentice', 'Aware', 'Practitioner', 'Guardian', 'Defender'] as const;
export type Level = (typeof LEVELS)[number];
