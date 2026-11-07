import { UserProgress } from '../../models/index.js';
import { toObjectId } from './ids.js';

/**
 * Writes to UserProgress. Every write is atomic and idempotent, because the learning engine has no
 * transactions (ADR 0007): a retry or a race can repeat a write but never corrupt a row.
 */
const isDuplicateKey = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;

const insertDefaults = (now: Date) => ({
  status: 'in_progress' as const,
  quizPassed: false,
  startedAt: now,
  contentCompletedAt: null,
  lastAttemptAt: null,
  exerciseAnswers: [],
});

/** Retries once when a concurrent upsert wins the unique (userId, moduleId) index. */
async function upsertWithRetry(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    await run();
  }
}

/** Create the row on first interaction; leave an existing row untouched. */
export async function ensureProgress(userId: string, moduleId: string, now: Date): Promise<void> {
  const filter = { userId: toObjectId(userId), moduleId: toObjectId(moduleId) };
  await upsertWithRetry(() =>
    UserProgress.updateOne(
      filter,
      { $setOnInsert: { ...insertDefaults(now), attempts: 0 } },
      { upsert: true },
    ),
  );
}

/** Count one attempt (any end reason). Only a submitted attempt can raise the best score. */
export async function recordAttemptOnProgress(
  userId: string,
  moduleId: string,
  attempt: { score: number; submitted: boolean; at: Date },
): Promise<void> {
  const filter = { userId: toObjectId(userId), moduleId: toObjectId(moduleId) };
  await upsertWithRetry(() =>
    UserProgress.updateOne(
      filter,
      {
        $inc: { attempts: 1 },
        $set: { lastAttemptAt: attempt.at },
        ...(attempt.submitted ? { $max: { quizScore: attempt.score } } : {}),
        $setOnInsert: (({ lastAttemptAt: _omit, ...rest }) => rest)(insertDefaults(attempt.at)),
      },
      { upsert: true },
    ),
  );
}

/** First pass only: the conditional update is what decides "first", never the client. */
export async function markFirstPass(userId: string, moduleId: string, at: Date): Promise<boolean> {
  const result = await UserProgress.updateOne(
    { userId: toObjectId(userId), moduleId: toObjectId(moduleId), quizPassed: false },
    { $set: { quizPassed: true, status: 'completed', completedAt: at } },
  );
  return result.modifiedCount === 1;
}
