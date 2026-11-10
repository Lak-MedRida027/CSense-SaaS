import {
  RISK_BANDS,
  RISK_LEVEL_TO_STATE,
  RISK_SCORE_MAX,
  RISK_SCORE_MIN,
  type GovernanceState,
  type RiskLevel,
} from '../constants/risk.js';

/** Map an integer composite 0-100 to its band. Throws on anything else. */
export function classifyRisk(composite: number): RiskLevel {
  if (
    typeof composite !== 'number' ||
    !Number.isInteger(composite) ||
    composite < RISK_SCORE_MIN ||
    composite > RISK_SCORE_MAX
  ) {
    throw new RangeError('composite must be an integer from 0 to 100');
  }
  const band = RISK_BANDS.find((b) => composite >= b.min && composite <= b.max);
  if (!band) throw new RangeError('composite is outside every band');
  return band.level;
}

export function riskStateFor(level: RiskLevel): GovernanceState {
  return RISK_LEVEL_TO_STATE[level];
}
