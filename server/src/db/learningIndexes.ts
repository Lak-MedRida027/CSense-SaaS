import type { Model } from 'mongoose';
import {
  Assessment,
  AssessmentSession,
  AttemptCounter,
  Module,
  QuizAttempt,
  UserProgress,
} from '../models/index.js';

/**
 * Unique indexes the learning engine relies on for correctness (one open session, one attempt per
 * session and number, one progress row, one counter). Mongoose builds indexes in the background
 * and nothing otherwise verifies them, so startup builds them explicitly and readiness checks them.
 */
interface RequiredIndex {
  model: Model<never>;
  name: string;
}

const required = (model: unknown, name: string): RequiredIndex => ({
  model: model as Model<never>,
  name,
});

export const REQUIRED_LEARNING_INDEXES: readonly RequiredIndex[] = [
  required(Module, 'order_1'),
  required(Assessment, 'quiz_per_module_unique'),
  required(Assessment, 'single_final_test'),
  required(UserProgress, 'userId_1_moduleId_1'),
  required(AssessmentSession, 'one_open_session'),
  required(QuizAttempt, 'sessionId_1'),
  required(QuizAttempt, 'attempt_number_unique'),
  required(AttemptCounter, 'userId_1_assessmentId_1'),
];

/** Names (collection.index) of required unique indexes that are missing. */
export async function missingLearningIndexes(): Promise<string[]> {
  const byCollection = new Map<string, Set<string>>();
  const missing: string[] = [];
  for (const { model, name } of REQUIRED_LEARNING_INDEXES) {
    const collection = model.collection.collectionName;
    let names = byCollection.get(collection);
    if (!names) {
      try {
        names = new Set((await model.collection.indexes()).map((i) => i.name ?? ''));
      } catch {
        names = new Set(); // collection not created yet
      }
      byCollection.set(collection, names);
    }
    if (!names.has(name)) missing.push(`${collection}.${name}`);
  }
  return missing;
}

/** Build the required indexes and fail loudly if any is still missing (startup, bootstrap). */
export async function ensureLearningIndexes(): Promise<void> {
  const models = new Set(REQUIRED_LEARNING_INDEXES.map((r) => r.model));
  let cause = '';
  try {
    await Promise.all([...models].map((m) => m.createIndexes()));
  } catch (err) {
    cause = err instanceof Error ? ` (${err.message})` : '';
  }
  const missing = await missingLearningIndexes();
  if (missing.length > 0) {
    throw new Error(
      `Required unique indexes are missing: ${missing.join(', ')}${cause}. Resolve duplicate data, then restart.`,
    );
  }
}
