import {
  RISK_DIMENSIONS,
  RISK_WEIGHTS_BP,
  RISK_WEIGHTS_BP_TOTAL,
  type DimensionCoverage,
  type RiskDimension,
} from '../constants/risk.js';
import { roundHalfUp } from './math.js';

export type DimensionScores = Record<RiskDimension, number | null>;
export type DimensionCoverageMap = Record<RiskDimension, DimensionCoverage>;
export type WeightsBp = Record<RiskDimension, number>;

const isAssessed = (
  d: RiskDimension,
  scores: DimensionScores,
  coverage: DimensionCoverageMap,
): boolean => coverage[d] === 'assessed' && scores[d] !== null;

/**
 * The weighted composite over the assessed dimensions only. The nominal weights (30/25/30/15) of
 * the remaining dimensions are re-normalised (D4-8). Null when no dimension is assessed.
 *   composite = round(sum(bp_i * s_i) / sum(bp_i))
 */
export function computeComposite(
  scores: DimensionScores,
  coverage: DimensionCoverageMap,
): number | null {
  let weighted = 0;
  let weights = 0;
  for (const d of RISK_DIMENSIONS) {
    const score = scores[d];
    if (score === null || !isAssessed(d, scores, coverage)) continue;
    weighted += RISK_WEIGHTS_BP[d] * score;
    weights += RISK_WEIGHTS_BP[d];
  }
  return weights === 0 ? null : roundHalfUp(weighted, weights);
}

/**
 * The weights actually applied, in basis points: 0 for excluded dimensions, rounded half up, with
 * any rounding remainder given to the largest weight so they sum to 10000. For display.
 */
export function effectiveWeights(
  scores: DimensionScores,
  coverage: DimensionCoverageMap,
): WeightsBp {
  const out: WeightsBp = { knowledge: 0, behavioural: 0, simulation: 0, engagement: 0 };
  const included = RISK_DIMENSIONS.filter((d) => isAssessed(d, scores, coverage));
  const total = included.reduce((sum, d) => sum + RISK_WEIGHTS_BP[d], 0);
  if (total === 0) return out;
  let largest: RiskDimension | null = null;
  let assigned = 0;
  for (const d of included) {
    out[d] = roundHalfUp(RISK_WEIGHTS_BP[d] * RISK_WEIGHTS_BP_TOTAL, total);
    assigned += out[d];
    if (largest === null || RISK_WEIGHTS_BP[d] > RISK_WEIGHTS_BP[largest]) largest = d;
  }
  if (largest !== null) out[largest] += RISK_WEIGHTS_BP_TOTAL - assigned;
  return out;
}
