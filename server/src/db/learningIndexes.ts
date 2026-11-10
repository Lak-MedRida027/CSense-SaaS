import type { Model } from 'mongoose';
import {
  Assessment,
  AssessmentSession,
  AttemptCounter,
  Module,
  QuizAttempt,
  UserProgress,
  AuditLog,
  BadgeAward,
  Escalation,
  ReconcileMarker,
  RiskProfile,
} from '../models/index.js';

/**
 * Unique indexes the learning engine relies on for correctness (one open session, one attempt per
 * session and number, one progress row, one counter). Mongoose builds indexes in the background
 * and nothing otherwise verifies them, so startup builds them explicitly and readiness checks them.
 * A check compares the definition, not just the name: an index of the right name that is not
 * unique, has other keys or lost its partial filter does not protect anything.
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
  // Phase 4: exactly-once awards, one profile per employee, the audit chain and escalation dedupe.
  required(BadgeAward, 'userId_1_badgeId_1'),
  required(RiskProfile, 'userId_1'),
  required(ReconcileMarker, 'userId_1'),
  required(Escalation, 'dedupeKey_1'),
  required(Escalation, 'active_scope_unique'),
  required(AuditLog, 'seq_1'),
  required(AuditLog, 'idempotencyKey_1'),
];

interface IndexDefinition {
  key: Record<string, unknown>;
  unique: boolean;
  partialFilterExpression: unknown;
}

const generatedName = (fields: Record<string, unknown>): string =>
  Object.entries(fields)
    .map(([field, direction]) => `${field}_${String(direction)}`)
    .join('_');

/** What the schema says the index must look like. */
function expectedDefinition({ model, name }: RequiredIndex): IndexDefinition {
  for (const [fields, options] of model.schema.indexes()) {
    const declared = (options as { name?: string; unique?: boolean }).name;
    if ((declared ?? generatedName(fields)) === name) {
      const opts = options as { unique?: boolean; partialFilterExpression?: unknown };
      return {
        key: fields,
        unique: opts.unique === true,
        partialFilterExpression: opts.partialFilterExpression,
      };
    }
  }
  throw new Error(`index ${name} is not declared on ${model.modelName}`);
}

/** Key order matters in an index, so keys are compared as ordered pairs. */
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function matches(actual: IndexDefinition, expected: IndexDefinition): boolean {
  return (
    same(Object.entries(actual.key), Object.entries(expected.key)) &&
    actual.unique === expected.unique &&
    same(actual.partialFilterExpression ?? null, expected.partialFilterExpression ?? null)
  );
}

/** Names (collection.index) of required indexes that are missing or defined differently. */
export async function missingLearningIndexes(): Promise<string[]> {
  const byCollection = new Map<string, Map<string, IndexDefinition>>();
  const missing: string[] = [];
  for (const required of REQUIRED_LEARNING_INDEXES) {
    const collection = required.model.collection.collectionName;
    let present = byCollection.get(collection);
    if (!present) {
      present = new Map();
      try {
        for (const index of await required.model.collection.indexes()) {
          present.set(index.name ?? '', {
            key: index.key,
            unique: index.unique === true,
            partialFilterExpression: index.partialFilterExpression,
          });
        }
      } catch {
        // collection not created yet: every index of it is missing
      }
      byCollection.set(collection, present);
    }
    const actual = present.get(required.name);
    if (!actual || !matches(actual, expectedDefinition(required))) {
      missing.push(`${collection}.${required.name}`);
    }
  }
  return missing;
}

/**
 * Build the required indexes and fail loudly if any is still missing or differently defined
 * (startup, bootstrap). An options conflict from `createIndexes` leaves the old index in place and
 * is therefore caught by the verification, not swallowed.
 */
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
      `Required unique indexes are missing or defined differently: ${missing.join(', ')}${cause}. Resolve duplicate data or drop the conflicting index, then restart.`,
    );
  }
}
