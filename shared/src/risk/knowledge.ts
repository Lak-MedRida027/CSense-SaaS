import { roundHalfUp } from './math.js';

export interface KnowledgeAttempt {
  assessmentId: string;
  attemptNumber: number;
  /** ISO-8601; breaks ties between equal attempt numbers. */
  attemptedAt: string;
  correctCount: number;
  totalCount: number;
}

/**
 * The first attempt of each assessment: the lowest attemptNumber, falling back to the earliest
 * attemptedAt when numbers tie. It never assumes an attempt numbered 1 exists.
 */
export function firstAttempts<
  T extends Pick<KnowledgeAttempt, 'assessmentId' | 'attemptNumber' | 'attemptedAt'>,
>(attempts: readonly T[]): T[] {
  const best = new Map<string, T>();
  for (const a of attempts) {
    const current = best.get(a.assessmentId);
    if (
      current === undefined ||
      a.attemptNumber < current.attemptNumber ||
      (a.attemptNumber === current.attemptNumber && a.attemptedAt < current.attemptedAt)
    ) {
      best.set(a.assessmentId, a);
    }
  }
  return [...best.values()];
}

/**
 * Knowledge risk: question-weighted error rate over the FIRST attempt of every assessment,
 * whatever its end reason (D4-3, D4-10). An abandoned or expired first attempt is 0 correct of the
 * served questions. Null when there is no attempt.
 */
export function knowledgeScore(attempts: readonly KnowledgeAttempt[]): number | null {
  let correct = 0;
  let total = 0;
  for (const a of firstAttempts(attempts)) {
    correct += a.correctCount;
    total += a.totalCount;
  }
  if (total === 0) return null;
  return roundHalfUp(100 * (total - correct), total);
}
