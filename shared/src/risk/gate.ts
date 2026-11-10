import {
  GATE_RESTRICTION_CAP,
  GATE_RESTRICTION_POINTS,
  GATE_RISK_WINDOW,
  type GateRunStatus,
} from '../constants/gate.js';
import { roundHalfUp } from './math.js';

/** One closed gate run, reduced to what the risk model needs (ADR 0017). */
export interface GateRunFact {
  status: Extract<GateRunStatus, 'passed' | 'restricted'>;
  /** Whether the first answer of the run was correct. */
  firstAnswerCorrect: boolean;
  /** ISO-8601 time the run closed (passed or restricted). */
  closedAt: string;
}

const time = (r: GateRunFact): number => {
  const t = Date.parse(r.closedAt);
  return Number.isNaN(t) ? 0 : t;
};

/** Deterministic order whatever the input order: by closedAt, then by the remaining fields. */
const byClosed = (a: GateRunFact, b: GateRunFact): number =>
  time(a) - time(b) ||
  a.status.localeCompare(b.status) ||
  Number(a.firstAnswerCorrect) - Number(b.firstAnswerCorrect);

/** The most recent `window` runs by closedAt. */
export function recentGateRuns(
  runs: readonly GateRunFact[],
  window = GATE_RISK_WINDOW,
): GateRunFact[] {
  return [...runs].sort(byClosed).slice(-window);
}

/**
 * Gate score (0..100, higher is riskier), ADR 0017. With n runs in the window, w of them with a
 * wrong first answer and r restricted:
 *   min(100, round(100 w / n) + 35 min(r, 2)).
 * Null when there are no closed runs.
 */
export function gateScore(runs: readonly GateRunFact[]): number | null {
  const recent = recentGateRuns(runs);
  const n = recent.length;
  if (n === 0) return null;
  const wrong = recent.filter((r) => !r.firstAnswerCorrect).length;
  const restricted = recent.filter((r) => r.status === 'restricted').length;
  return Math.min(
    100,
    roundHalfUp(100 * wrong, n) +
      GATE_RESTRICTION_POINTS * Math.min(restricted, GATE_RESTRICTION_CAP),
  );
}
