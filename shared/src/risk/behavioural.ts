import {
  CONDUCT_COOLDOWN_CAP,
  CONDUCT_COOLDOWN_POINTS,
  CONDUCT_RETRY_ALLOWANCE,
} from '../constants/risk.js';
import type { AttemptEndReason } from '../constants/learning.js';
import { roundHalfUp } from './math.js';

export interface ConductAttempt {
  assessmentId: string;
  endReason: AttemptEndReason;
  passed: boolean;
}

export interface ConductSummary {
  attempts: number;
  /** Abandoned plus expired attempts. */
  leftEarly: number;
  assessments: number;
  /** Failed submissions beyond the first, per assessment, summed. */
  extraFailures: number;
}

export function summariseConduct(attempts: readonly ConductAttempt[]): ConductSummary {
  const failedSubmitted = new Map<string, number>();
  const seen = new Set<string>();
  let leftEarly = 0;
  for (const a of attempts) {
    seen.add(a.assessmentId);
    if (a.endReason !== 'submitted') leftEarly += 1;
    else if (!a.passed) {
      failedSubmitted.set(a.assessmentId, (failedSubmitted.get(a.assessmentId) ?? 0) + 1);
    }
  }
  let extraFailures = 0;
  for (const n of failedSubmitted.values()) extraFailures += Math.max(0, n - 1);
  return { attempts: attempts.length, leftEarly, assessments: seen.size, extraFailures };
}

/**
 * Assessment conduct (D4-9): the average of the share of attempts that were abandoned or expired
 * (leaving the kiosk) and a saturating share of repeated failed submissions (guessing loops).
 * With n attempts, a left early, m assessments, x extra failures and R = 3m:
 *   conduct = round(100 (a R + n min(x, R)) / (2 n R)).
 * Null when there are no attempts. Timing is deliberately not used: it is not rebuildable.
 */
export function conductScore(attempts: readonly ConductAttempt[]): number | null {
  const s = summariseConduct(attempts);
  if (s.attempts === 0) return null;
  const r = CONDUCT_RETRY_ALLOWANCE * s.assessments;
  return roundHalfUp(
    100 * (s.leftEarly * r + s.attempts * Math.min(s.extraFailures, r)),
    2 * s.attempts * r,
  );
}

/**
 * Model v1: Behavioural is the conduct score plus a penalty for assessment cooldowns (three failed
 * attempts in a row at one assessment): 25 points each, at most two counted, capped at 100.
 * Phase 5 blends the gate group in (model v2).
 */
export function behaviouralScore(
  attempts: readonly ConductAttempt[],
  cooldowns = 0,
): number | null {
  const conduct = conductScore(attempts);
  if (conduct === null) return null;
  const penalty = CONDUCT_COOLDOWN_POINTS * Math.min(Math.max(0, cooldowns), CONDUCT_COOLDOWN_CAP);
  return Math.min(100, conduct + penalty);
}
