import { z } from 'zod';
import { LEVELS } from '../constants/levels.js';

/** Strict response schemas for the employee gamification endpoints (Phase 4). */
const levelSchema = z.enum(LEVELS);

export const xpSummarySchema = z
  .object({
    totalXP: z.number().int().min(0),
    level: levelSchema,
    tier: z.number().int().min(1).max(5),
    currentLevelFloorXP: z.number().int().min(0),
    nextLevel: levelSchema.nullable(),
    nextLevelXP: z.number().int().min(0).nullable(),
    xpToNextLevel: z.number().int().min(0).nullable(),
    thresholds: z
      .object({
        Apprentice: z.number().int(),
        Aware: z.number().int(),
        Practitioner: z.number().int(),
        Guardian: z.number().int(),
        Defender: z.number().int(),
      })
      .strict(),
  })
  .strict();

export const badgeProgressSchema = z
  .object({
    badgeId: z.string(),
    name: z.string(),
    iconMotif: z.string(),
    moduleId: z.string(),
    moduleTitle: z.string(),
    /** Position in the current curriculum; null for a badge of a module that is no longer in it. */
    position: z.number().int().min(1).nullable(),
    earned: z.boolean(),
    earnedAt: z.string().nullable(),
  })
  .strict();

export const myBadgesSchema = z
  .object({
    items: z.array(badgeProgressSchema),
    earnedCount: z.number().int().min(0),
    totalCount: z.number().int().min(0),
  })
  .strict();

export type XpSummaryDTO = z.infer<typeof xpSummarySchema>;
export type BadgeProgressDTO = z.infer<typeof badgeProgressSchema>;
export type MyBadgesDTO = z.infer<typeof myBadgesSchema>;
