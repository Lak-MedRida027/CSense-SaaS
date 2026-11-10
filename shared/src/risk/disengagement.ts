export type DisengagementReason = 'disengaged_unassessed' | 'disengaged_no_progress';

export interface DisengagementFacts {
  /** Epoch milliseconds. */
  nowMs: number;
  /** Days without progress after which an employee is flagged. */
  afterDays: number;
  /** When the stall started: see `stallAnchorMs`. */
  anchorMs: number;
  /** The employee has a risk level (two first attempts or enough of them, D4-12). */
  assessed: boolean;
  /** There is something to complete (published modules or a final test). */
  hasCurriculum: boolean;
  /** Every published module and the final test (if any) are passed. */
  finished: boolean;
  /** An escalation of this kind is already open. */
  alreadyActive: boolean;
}

/**
 * The start of the current stall: the latest of account creation, any learning progress (module
 * start, exercise answer, content completion, attempt) and the resolution of an earlier
 * disengagement escalation. Latest wins, so resolving one gives the employee a fresh period.
 */
export function stallAnchorMs(points: readonly (number | null | undefined)[]): number {
  let latest = 0;
  for (const p of points) if (typeof p === 'number' && p > latest) latest = p;
  return latest;
}

/**
 * Decide whether an employee should be flagged as disengaged (P4-L5, P4-L12): an unfinished
 * curriculum and no progress for `afterDays`. The reason says whether they were ever assessed.
 * Pure and exact at the boundary: a stall of exactly `afterDays` days qualifies.
 */
export function decideDisengagement(f: DisengagementFacts): DisengagementReason | null {
  if (f.alreadyActive || !f.hasCurriculum || f.finished) return null;
  if (f.nowMs - f.anchorMs < f.afterDays * 86_400_000) return null;
  return f.assessed ? 'disengaged_no_progress' : 'disengaged_unassessed';
}
