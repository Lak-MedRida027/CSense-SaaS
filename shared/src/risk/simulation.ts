import {
  SIMULATION_OUTCOME_POINTS,
  SIMULATION_WINDOW,
  type SimulationOutcome,
} from '../constants/risk.js';
import { roundHalfUp } from './math.js';

export interface SimulationFact {
  outcome: SimulationOutcome;
  /** ISO-8601 timestamp. */
  occurredAt: string;
}

/** Average points of the last five outcomes by time. Null when there are none. */
export function simulationScore(outcomes: readonly SimulationFact[]): number | null {
  if (outcomes.length === 0) return null;
  const recent = [...outcomes]
    .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0))
    .slice(-SIMULATION_WINDOW);
  const points = recent.reduce((sum, o) => sum + SIMULATION_OUTCOME_POINTS[o.outcome], 0);
  return roundHalfUp(points, recent.length);
}
