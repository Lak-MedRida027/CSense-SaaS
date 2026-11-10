/** XP rules (Phase 4, ADR 0009, decision D4-1). */
export const XP_RULES = Object.freeze({
  moduleCompletion: 150,
  moduleFirstTry: 100,
  modulePerfect: 50,
  /** Per exercise answered correctly on the first try, once the module is passed. */
  modulePracticeEach: 10,
  finalCompletion: 400,
  finalFirstTry: 200,
  finalPerfect: 100,
  /** Per organisation-local day with a passed gate run whose first answer was correct (ADR 0017). */
  gateDailyCheck: 10,
});

export const XP_SOURCES = [
  'module_completion',
  'module_first_try',
  'module_perfect',
  'module_practice',
  'final_completion',
  'final_first_try',
  'final_perfect',
  'gate_daily_check',
] as const;
export type XpSource = (typeof XP_SOURCES)[number];

/**
 * Icon vocabulary for badges. Mirrors the keys of the desktop `BADGE_MOTIFS` map (Phase 6 re-types
 * that map against this list).
 */
export const BADGE_ICON_MOTIFS = [
  'welcome',
  'password',
  'key',
  'phishing',
  'mail',
  'social-engineering',
  'users',
  'device',
  'lock',
  'click',
  'shield',
  'shield-check',
  'target',
  'trophy',
  'star',
] as const;
export type BadgeIconMotif = (typeof BADGE_ICON_MOTIFS)[number];

export const BADGE_NAME_MAX = 120;
export const BADGE_AWARD_SOURCES = ['completion', 'reconcile'] as const;
export type BadgeAwardSource = (typeof BADGE_AWARD_SOURCES)[number];
