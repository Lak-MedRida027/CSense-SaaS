/**
 * Risk engine constants (CLAUDE.md "Risk engine (fixed weights)", Client Needs FR11, ADR 0010).
 * Every sub-score and the composite are integers 0-100 where HIGHER MEANS RISKIER (D4-6).
 */
export const RISK_DIMENSIONS = ['knowledge', 'behavioural', 'simulation', 'engagement'] as const;
export type RiskDimension = (typeof RISK_DIMENSIONS)[number];

export const RISK_WEIGHTS: Readonly<Record<RiskDimension, number>> = Object.freeze({
  knowledge: 0.3,
  behavioural: 0.25,
  simulation: 0.3,
  engagement: 0.15,
});

/** The same weights in basis points (x 10000), so the engine never touches floating point. */
export const RISK_WEIGHTS_BP: Readonly<Record<RiskDimension, number>> = Object.freeze({
  knowledge: 3000,
  behavioural: 2500,
  simulation: 3000,
  engagement: 1500,
});
export const RISK_WEIGHTS_BP_TOTAL = 10_000;

export const RISK_LEVELS = ['Low', 'Medium', 'High'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export interface RiskBand {
  readonly level: RiskLevel;
  readonly min: number;
  readonly max: number;
}

/** Inclusive integer bands over the composite score (D4-7). */
export const RISK_BANDS: readonly RiskBand[] = Object.freeze([
  Object.freeze({ level: 'Low', min: 0, max: 39 } as const),
  Object.freeze({ level: 'Medium', min: 40, max: 69 } as const),
  Object.freeze({ level: 'High', min: 70, max: 100 } as const),
]);

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

/** Model v2 (Phase 5, ADR 0017): Behavioural blends the gate signals with assessment conduct. */
export const RISK_MODEL_VERSION = 2;

/** Classified only after first attempts on this many assessments (or all of them if fewer exist). */
export const RISK_MIN_FIRST_ATTEMPTS = 2;

/** Extra failed submissions per assessment that saturate the retry rate (conduct score). */
export const CONDUCT_RETRY_ALLOWANCE = 3;

/** Each assessment cooldown adds this many points to conduct risk, up to the cap below. */
export const CONDUCT_COOLDOWN_POINTS = 25;
export const CONDUCT_COOLDOWN_CAP = 2;

/** Used from Phase 5 (model v2): the gate signals and the assessment conduct are blended. */
export const BEHAVIOURAL_GROUP_WEIGHTS: Readonly<{ gate: number; conduct: number }> = Object.freeze(
  {
    gate: 70,
    conduct: 30,
  },
);

export const SIMULATION_OUTCOMES = [
  'reported',
  'no_action',
  'clicked_then_reported',
  'clicked',
  'credentials_submitted',
] as const;
export type SimulationOutcome = (typeof SIMULATION_OUTCOMES)[number];

export const SIMULATION_OUTCOME_POINTS: Readonly<Record<SimulationOutcome, number>> = Object.freeze(
  {
    reported: 0,
    no_action: 25,
    clicked_then_reported: 50,
    clicked: 75,
    credentials_submitted: 100,
  },
);

/** Only the most recent outcomes count toward the Simulation score. */
export const SIMULATION_WINDOW = 5;

export const DIMENSION_COVERAGE = ['assessed', 'not_assessed', 'disabled'] as const;
export type DimensionCoverage = (typeof DIMENSION_COVERAGE)[number];
