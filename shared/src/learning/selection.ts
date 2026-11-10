/**
 * Question-pool sampling (P3-M1, ADR 0007). An assessment holds a pool and serves a subset per
 * session. The subset prefers questions the employee has not been served before, so retries do not
 * replay the same items (which would turn the per-question feedback into a key oracle). When unseen
 * questions run out, the least recently served come first. Order inside each tier is random and
 * comes from the injected `shuffle`, so tests stay deterministic.
 */
export type ShuffleFn = <T>(items: readonly T[]) => T[];

/**
 * @param pool question ids of the assessment
 * @param history ids served in each previous attempt at this assessment, oldest attempt first
 * @param count how many to serve
 * @returns the ids to serve, in presentation order
 */
export function selectQuestionIds(
  pool: readonly string[],
  history: readonly (readonly string[])[],
  count: number,
  shuffle: ShuffleFn,
): string[] {
  if (!Number.isInteger(count) || count < 1) throw new Error('count must be an integer >= 1');
  if (pool.length === 0) throw new Error('cannot select from an empty pool');
  if (count >= pool.length) return shuffle(pool);

  const inPool = new Set(pool);
  const lastServed = new Map<string, number>();
  history.forEach((served, attemptIndex) => {
    for (const id of served) if (inPool.has(id)) lastServed.set(id, attemptIndex);
  });

  const unseen = pool.filter((id) => !lastServed.has(id));
  const byAttempt = new Map<number, string[]>();
  for (const id of pool) {
    const at = lastServed.get(id);
    if (at !== undefined) byAttempt.set(at, [...(byAttempt.get(at) ?? []), id]);
  }
  // Unseen first, then the tier served longest ago, and so on towards the most recent attempt.
  const tiers = [
    unseen,
    ...[...byAttempt.entries()].sort((a, b) => a[0] - b[0]).map(([, ids]) => ids),
  ];

  const chosen: string[] = [];
  for (const tier of tiers) {
    if (chosen.length >= count) break;
    chosen.push(...shuffle(tier).slice(0, count - chosen.length));
  }
  return shuffle(chosen);
}
