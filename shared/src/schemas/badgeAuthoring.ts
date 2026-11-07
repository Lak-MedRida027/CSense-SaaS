import { z } from 'zod';
import { BADGE_ICON_MOTIFS, BADGE_NAME_MAX } from '../constants/gamification.js';

/** Authoring shape of a badge (one per module). Reused by the seed now and the admin console later. */
export const badgeAuthoringSchema = z
  .object({
    name: z.string().trim().min(1).max(BADGE_NAME_MAX),
    iconMotif: z.enum(BADGE_ICON_MOTIFS),
  })
  .strict();

export type BadgeAuthoring = z.infer<typeof badgeAuthoringSchema>;
