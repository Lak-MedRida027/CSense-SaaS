import { Types, trusted } from 'mongoose';
import {
  deriveFinalTestState,
  deriveModuleStates,
  type DerivedModuleState,
  type ModuleFacts,
  type ModuleFormat,
  type ProgressStatus,
} from '@csense/shared';
import {
  AssessmentSession,
  AttemptCounter,
  FinalTest,
  Module,
  Quiz,
  QuizAttempt,
  UserProgress,
} from '../../models/index.js';
import { toObjectId } from './ids.js';
import { ensureProgress, markFirstPass } from './progress.store.js';

export interface CurriculumEntry {
  id: string;
  order: number;
  title: string;
  description: string;
  format: ModuleFormat;
  duration: number;
}

export interface ProgressRow {
  moduleId: string;
  startedAt: Date | null;
  contentCompletedAt: Date | null;
  exerciseAnswers: { exerciseId: string; selectedIndex: number; correct: boolean }[];
  attempts: number;
  bestScore: number | null;
  quizPassed: boolean;
  completedAt: Date | null;
}

export interface AssessmentSummary {
  id: string;
  title: string;
  passingScore: number;
  /** Questions one session serves (not the pool size). */
  questionCount: number;
  poolSize: number;
}

export interface AttemptStats {
  attempts: number;
  bestScore: number | null;
  passed: boolean;
  completedAt: Date | null;
  cooldownUntil: Date | null;
  /** Any attempt recorded or a session currently open. */
  started: boolean;
}

export interface LearningState {
  curriculum: CurriculumEntry[];
  progress: Map<string, ProgressRow>;
  states: DerivedModuleState[];
  stateById: Map<string, DerivedModuleState>;
  entryById: Map<string, CurriculumEntry>;
  /** Keyed by module id. */
  quizzes: Map<string, AssessmentSummary>;
  finalTest: AssessmentSummary | null;
  finalStats: AttemptStats;
  /** Cooldown end per assessment id (quizzes and the final test); null when none. */
  cooldowns: Map<string, Date | null>;
  finalState: { status: ProgressStatus; remainingModules: number };
}

export { toObjectId };
const hex = (id: Types.ObjectId): string => id.toHexString();

/**
 * The only place that decides which modules an employee is expected to take. Phase 3: every
 * published module, in ascending `order`. Phase 7 filters this by assignment (ADR 0006).
 */
export async function curriculumFor(_userId: string): Promise<CurriculumEntry[]> {
  const docs = await Module.find({ isPublished: true })
    .select('order title description format duration')
    .sort({ order: 1 })
    .lean();
  return docs.map((d) => ({
    id: hex(d._id),
    order: d.order,
    title: d.title,
    description: d.description,
    format: d.format,
    duration: d.duration,
  }));
}

async function loadProgress(userId: string): Promise<Map<string, ProgressRow>> {
  const rows = await UserProgress.find({ userId }).lean();
  return new Map(
    rows.map((r): [string, ProgressRow] => [
      hex(r.moduleId),
      {
        moduleId: hex(r.moduleId),
        startedAt: r.startedAt ?? null,
        contentCompletedAt: r.contentCompletedAt ?? null,
        exerciseAnswers: r.exerciseAnswers.map((a) => ({
          exerciseId: hex(a.exerciseId),
          selectedIndex: a.selectedIndex,
          correct: a.correct,
        })),
        attempts: r.attempts,
        bestScore: r.quizScore ?? null,
        quizPassed: r.quizPassed,
        completedAt: r.completedAt ?? null,
      },
    ]),
  );
}

/**
 * History summary for one assessment from the ledger (one document), not an aggregation over the
 * caller's attempts. A passing attempt in the append-only history also counts as passed, so a
 * missed ledger write cannot hide a pass.
 */
export async function attemptStats(userId: string, assessmentId: string): Promise<AttemptStats> {
  const owner = toObjectId(userId);
  const assessment = toObjectId(assessmentId);
  const [counter, passedAttempt, open] = await Promise.all([
    AttemptCounter.findOne({ userId: owner, assessmentId: assessment }).lean(),
    QuizAttempt.exists({ userId: owner, refId: assessment, passed: true }),
    AssessmentSession.exists({ userId: owner, assessmentId: assessment, status: 'open' }),
  ]);
  const attempts = counter?.attempts ?? 0;
  return {
    attempts,
    bestScore: counter?.bestScore ?? null,
    passed: counter?.firstPassAt != null || passedAttempt !== null,
    completedAt: counter?.firstPassAt ?? null,
    cooldownUntil: counter?.cooldownUntil ?? null,
    started: attempts > 0 || open !== null,
  };
}

/**
 * Repair-on-read (P3-L1). The append-only history is the record of truth: a module with a stored
 * passing attempt is passed even if the progress write that should have followed was lost. The
 * returned rows are patched, and the stored row is repaired best-effort.
 */
async function applyHistoricalPasses(
  userId: string,
  entries: readonly CurriculumEntry[],
  progress: Map<string, ProgressRow>,
): Promise<void> {
  const owner = toObjectId(userId);
  const passes = await QuizAttempt.find({ userId: owner, type: 'Quiz', passed: true })
    .select('moduleId score attemptedAt')
    .sort({ attemptedAt: 1 })
    .limit(500)
    .lean();
  const inCurriculum = new Set(entries.map((e) => e.id));
  const seen = new Set<string>();
  for (const pass of passes) {
    const moduleId = pass.moduleId ? hex(pass.moduleId) : null;
    if (!moduleId || !inCurriculum.has(moduleId) || seen.has(moduleId)) continue;
    seen.add(moduleId);
    const row = progress.get(moduleId);
    if (row?.quizPassed === true) continue;
    progress.set(moduleId, {
      moduleId,
      startedAt: row?.startedAt ?? pass.attemptedAt,
      contentCompletedAt: row?.contentCompletedAt ?? null,
      exerciseAnswers: row?.exerciseAnswers ?? [],
      attempts: Math.max(row?.attempts ?? 0, 1),
      bestScore: Math.max(row?.bestScore ?? 0, pass.score),
      quizPassed: true,
      completedAt: row?.completedAt ?? pass.attemptedAt,
    });
    try {
      await ensureProgress(userId, moduleId, pass.attemptedAt);
      await markFirstPass(userId, moduleId, pass.attemptedAt);
    } catch {
      // Best effort: the next read tries again, and the response is already correct.
    }
  }
}

/** Everything a learning response needs, loaded fresh on every request (nothing is cached). */
export async function loadLearningState(userId: string): Promise<LearningState> {
  const [curriculum, progress] = await Promise.all([curriculumFor(userId), loadProgress(userId)]);
  const ids = curriculum.map((c) => toObjectId(c.id));

  await applyHistoricalPasses(userId, curriculum, progress);
  const facts = new Map<string, ModuleFacts>();
  for (const entry of curriculum) {
    const row = progress.get(entry.id);
    facts.set(entry.id, { started: row !== undefined, passed: row?.quizPassed === true });
  }
  const states = deriveModuleStates(curriculum, facts);

  const quizDocs = await Quiz.find({ moduleId: trusted({ $in: ids }) })
    .select('moduleId title passingScore questionsPerSession questions.questionId')
    .lean();
  const quizzes = new Map<string, AssessmentSummary>(
    quizDocs.map((q): [string, AssessmentSummary] => [
      hex(q.moduleId),
      {
        id: hex(q._id),
        title: q.title,
        passingScore: q.passingScore,
        questionCount: Math.min(q.questionsPerSession ?? q.questions.length, q.questions.length),
        poolSize: q.questions.length,
      },
    ]),
  );

  const finalDoc = await FinalTest.findOne({})
    .select('title passingScore questionsPerSession questions.questionId')
    .lean();
  const finalTest: AssessmentSummary | null = finalDoc
    ? {
        id: hex(finalDoc._id),
        title: finalDoc.title,
        passingScore: finalDoc.passingScore,
        questionCount: Math.min(
          finalDoc.questionsPerSession ?? finalDoc.questions.length,
          finalDoc.questions.length,
        ),
        poolSize: finalDoc.questions.length,
      }
    : null;
  const finalStats: AttemptStats = finalTest
    ? await attemptStats(userId, finalTest.id)
    : {
        attempts: 0,
        bestScore: null,
        passed: false,
        completedAt: null,
        cooldownUntil: null,
        started: false,
      };

  const quizCounters = await AttemptCounter.find({
    userId: toObjectId(userId),
    assessmentId: trusted({ $in: [...quizzes.values()].map((q) => toObjectId(q.id)) }),
  })
    .select('assessmentId cooldownUntil')
    .lean();
  const cooldowns = new Map<string, Date | null>(
    quizCounters.map((c): [string, Date | null] => [hex(c.assessmentId), c.cooldownUntil ?? null]),
  );
  if (finalTest) cooldowns.set(finalTest.id, finalStats.cooldownUntil);

  return {
    curriculum,
    progress,
    states,
    stateById: new Map(states.map((s) => [s.moduleId, s])),
    entryById: new Map(curriculum.map((c) => [c.id, c])),
    quizzes,
    finalTest,
    finalStats,
    cooldowns,
    finalState: deriveFinalTestState(states, {
      passed: finalStats.passed,
      started: finalStats.started,
    }),
  };
}
