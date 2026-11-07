import { trusted } from 'mongoose';
import { AttemptCounter } from '../../models/index.js';
import { toObjectId } from './ids.js';

/**
 * Writes to the per-(employee, assessment) ledger (`AttemptCounter`). Every write is one atomic
 * operation, so attempt numbers and "first pass" are decided by the database, not by a
 * check-then-insert (P3-L2).
 */
const isDuplicateKey = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;

async function withUpsertRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    return run(); // a concurrent upsert created the document first; the second run updates it
  }
}

/** Hand out the next attempt number for this employee and assessment (1, 2, 3, ...). */
export async function allocateAttemptNumber(userId: string, assessmentId: string): Promise<number> {
  const filter = { userId: toObjectId(userId), assessmentId: toObjectId(assessmentId) };
  const doc = await withUpsertRetry(() =>
    AttemptCounter.findOneAndUpdate(
      filter,
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' },
    ).lean(),
  );
  return doc.seq;
}

/**
 * Count a recorded attempt (any end reason) and keep the failure streak. Only a submitted attempt
 * can raise the best score; a pass resets the streak, anything else extends it. Returns the streak
 * after this attempt (one atomic update, so racing failures get distinct values).
 */
export async function countOnLedger(
  userId: string,
  assessmentId: string,
  attempt: { attemptNumber: number; score: number; submitted: boolean; passed: boolean; at: Date },
): Promise<number> {
  const filter = { userId: toObjectId(userId), assessmentId: toObjectId(assessmentId) };
  const doc = await withUpsertRetry(() =>
    AttemptCounter.findOneAndUpdate(
      filter,
      {
        $inc: attempt.passed ? { attempts: 1 } : { attempts: 1, consecutiveFails: 1 },
        ...(attempt.passed ? { $set: { consecutiveFails: 0 } } : {}),
        ...(attempt.submitted ? { $max: { bestScore: attempt.score } } : {}),
        $setOnInsert: { seq: attempt.attemptNumber, firstPassAt: null, cooldownUntil: null },
      },
      { upsert: true, returnDocument: 'after' },
    ).lean(),
  );
  return doc.consecutiveFails;
}

/**
 * Start a cooldown when the failure streak has reached the limit (P3-M1). The conditional update
 * matches only while the streak is still at the limit, so when failures race exactly one caller
 * starts the cooldown (and writes the audit entry), and none is skipped. The streak restarts from
 * zero, so the next cooldown needs another full set of failures.
 */
export async function startCooldownIfDue(
  userId: string,
  assessmentId: string,
  streak: number,
  rule: { afterFails: number; minutes: number; now: Date },
): Promise<Date | null> {
  if (streak < rule.afterFails) return null;
  const until = new Date(rule.now.getTime() + rule.minutes * 60_000);
  const started = await AttemptCounter.updateOne(
    {
      userId: toObjectId(userId),
      assessmentId: toObjectId(assessmentId),
      consecutiveFails: trusted({ $gte: rule.afterFails }),
    },
    { $set: { cooldownUntil: until, consecutiveFails: 0 } },
  );
  return started.modifiedCount === 1 ? until : null;
}

/**
 * Try to claim the first pass. Exactly one caller ever gets true per employee and assessment: the
 * conditional update matches only while firstPassAt is still null.
 */
export async function claimFirstPass(
  userId: string,
  assessmentId: string,
  at: Date,
): Promise<boolean> {
  const claim = await AttemptCounter.updateOne(
    { userId: toObjectId(userId), assessmentId: toObjectId(assessmentId), firstPassAt: null },
    { $set: { firstPassAt: at } },
  );
  return claim.modifiedCount === 1;
}
