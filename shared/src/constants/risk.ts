/**
 * Risk engine constants (CLAUDE.md "Risk engine (fixed weights)", Client Needs FR11).
 * Band cut-offs and score direction are an open decision (U7) and are added in Phase 4.
 */
export const RISK_DIMENSIONS = ['knowledge', 'behavioural', 'simulation', 'engagement'] as const;
export type RiskDimension = (typeof RISK_DIMENSIONS)[number];

export const RISK_WEIGHTS: Readonly<Record<RiskDimension, number>> = Object.freeze({
  knowledge: 0.3,
  behavioural: 0.25,
  simulation: 0.3,
  engagement: 0.15,
});

export const RISK_LEVELS = ['Low', 'Medium', 'High'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const GOVERNANCE_STATES = ['Green', 'Amber', 'Red'] as const;
export type GovernanceState = (typeof GOVERNANCE_STATES)[number];

export const RISK_LEVEL_TO_STATE: Readonly<Record<RiskLevel, GovernanceState>> = Object.freeze({
  Low: 'Green',
  Medium: 'Amber',
  High: 'Red',
});

/** Sub-scores are integers on a 0-100 scale. */
export const RISK_SCORE_MIN = 0;
export const RISK_SCORE_MAX = 100;
