import type { AttemptResultDTO, XpSummaryDTO } from '../../../../shared/dto';

export interface Achievements {
  badge?: { id: string; name: string; motif: string };
  levelUp?: { from: string; to: string };
  trainingComplete?: boolean;
}

/**
 * What to celebrate after an attempt (plan 7.5). Pure. `before` is the cached XP summary from before
 * the attempt: without it no level-up is claimed. A final-assessment pass is "training complete";
 * the final carries no badge (D4-4).
 */
export function detectAchievements(
  before: XpSummaryDTO | null,
  after: XpSummaryDTO | null,
  result: AttemptResultDTO | null,
): Achievements {
  const out: Achievements = {};
  if (!result || !result.passed) return out;
  const badge = result.effects.badge;
  if (badge) out.badge = { id: badge.id, name: badge.name, motif: badge.iconMotif };
  if (before && after && before.level !== after.level && after.tier > before.tier) {
    out.levelUp = { from: before.level, to: after.level };
  }
  if (result.kind === 'FinalTest') out.trainingComplete = true;
  return out;
}

export const hasAchievements = (a: Achievements): boolean =>
  a.badge !== undefined || a.levelUp !== undefined || a.trainingComplete === true;
