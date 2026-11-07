import type {
  AttemptSummaryDTO,
  FinalTestOverviewDTO,
  FinalTestStatusDTO,
  ModuleProgressDTO,
  ModuleSummaryDTO,
  QuizBlockedReason,
  QuizOverviewDTO,
} from '@csense/shared';
import type {
  AssessmentSummary,
  CurriculumEntry,
  LearningState,
  ProgressRow,
} from './curriculum.service.js';

/**
 * Explicit whitelist mappers: every employee-facing object is built field by field, never from
 * `doc.toJSON()`, so a new or secret field on a model cannot reach a response by accident.
 */
/** The end of a running cooldown, or null when none applies at `now`. */
export function activeCooldown(state: LearningState, assessmentId: string, now: Date): Date | null {
  const until = state.cooldowns.get(assessmentId) ?? null;
  return until && until.getTime() > now.getTime() ? until : null;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toModuleSummary(state: LearningState, entry: CurriculumEntry): ModuleSummaryDTO {
  const derived = state.stateById.get(entry.id);
  if (!derived) throw new Error('module is not in the curriculum');
  const row = state.progress.get(entry.id);
  const blocker = derived.lockedBy ? state.entryById.get(derived.lockedBy) : undefined;
  const blockerState = derived.lockedBy ? state.stateById.get(derived.lockedBy) : undefined;
  return {
    id: entry.id,
    position: derived.position,
    title: entry.title,
    description: entry.description,
    format: entry.format,
    durationMinutes: entry.duration,
    status: derived.status,
    lockedBy:
      blocker && blockerState
        ? { moduleId: blocker.id, position: blockerState.position, title: blocker.title }
        : null,
    attempts: row?.attempts ?? 0,
    bestScore: row?.bestScore ?? null,
    passed: row?.quizPassed === true,
    completedAt: iso(row?.completedAt ?? null),
  };
}

export function toFinalTestStatus(
  state: LearningState,
  summary: AssessmentSummary,
): FinalTestStatusDTO {
  return {
    status: state.finalState.status,
    title: summary.title,
    questionCount: summary.questionCount,
    passingScore: summary.passingScore,
    remainingModules: state.finalState.remainingModules,
    attempts: state.finalStats.attempts,
    bestScore: state.finalStats.bestScore,
    passed: state.finalStats.passed,
    completedAt: iso(state.finalStats.completedAt),
  };
}

export function toFinalTestOverview(
  state: LearningState,
  summary: AssessmentSummary,
  now: Date,
): FinalTestOverviewDTO {
  let blockedReason: QuizBlockedReason | null = null;
  if (state.finalState.status === 'locked') blockedReason = 'module_locked';
  else if (state.finalStats.passed) blockedReason = 'already_passed';
  else if (summary.questionCount < 1) blockedReason = 'quiz_unavailable';
  const cooldownUntil = activeCooldown(state, summary.id, now);
  if (blockedReason === null && cooldownUntil) blockedReason = 'cooldown';
  return {
    ...toFinalTestStatus(state, summary),
    finalTestId: summary.id,
    nextAttemptNumber: state.finalStats.attempts + 1,
    canStart: blockedReason === null,
    blockedReason,
    cooldownUntil: cooldownUntil ? cooldownUntil.toISOString() : null,
  };
}

export function toModuleProgress(
  state: LearningState,
  moduleId: string,
  row: ProgressRow | undefined,
): ModuleProgressDTO {
  const derived = state.stateById.get(moduleId);
  return {
    moduleId,
    status: derived?.status ?? 'locked',
    startedAt: iso(row?.startedAt ?? null),
    contentCompletedAt: iso(row?.contentCompletedAt ?? null),
    exerciseAnswers: (row?.exerciseAnswers ?? []).map((a) => ({
      exerciseId: a.exerciseId,
      selectedIndex: a.selectedIndex,
      correct: a.correct,
    })),
  };
}

export function toQuizOverview(
  state: LearningState,
  moduleId: string,
  quiz: AssessmentSummary,
  now: Date,
): QuizOverviewDTO {
  const derived = state.stateById.get(moduleId);
  const row = state.progress.get(moduleId);
  let blockedReason: QuizBlockedReason | null = null;
  if (!derived || derived.status === 'locked') blockedReason = 'module_locked';
  else if (row?.quizPassed === true) blockedReason = 'already_passed';
  else if (row?.contentCompletedAt == null) blockedReason = 'content_incomplete';
  else if (quiz.questionCount < 1) blockedReason = 'quiz_unavailable';
  const cooldownUntil = activeCooldown(state, quiz.id, now);
  if (blockedReason === null && cooldownUntil) blockedReason = 'cooldown';
  return {
    quizId: quiz.id,
    moduleId,
    title: quiz.title,
    questionCount: quiz.questionCount,
    passingScore: quiz.passingScore,
    attempts: row?.attempts ?? 0,
    nextAttemptNumber: (row?.attempts ?? 0) + 1,
    bestScore: row?.bestScore ?? null,
    passed: row?.quizPassed === true,
    canStart: blockedReason === null,
    blockedReason,
    cooldownUntil: cooldownUntil ? cooldownUntil.toISOString() : null,
  };
}

interface AttemptLike {
  _id: { toHexString(): string };
  type: 'Quiz' | 'FinalTest';
  refId: { toHexString(): string };
  moduleId?: { toHexString(): string } | null | undefined;
  attemptNumber: number;
  endReason: 'submitted' | 'abandoned' | 'expired';
  score: number;
  passed: boolean;
  correctCount: number;
  totalCount: number;
  passingScore: number;
  attemptedAt: Date;
}

export function toAttemptSummary(a: AttemptLike): AttemptSummaryDTO {
  return {
    attemptId: a._id.toHexString(),
    kind: a.type,
    assessmentId: a.refId.toHexString(),
    moduleId: a.moduleId ? a.moduleId.toHexString() : null,
    attemptNumber: a.attemptNumber,
    endReason: a.endReason,
    score: a.score,
    passed: a.passed,
    correctCount: a.correctCount,
    totalCount: a.totalCount,
    passingScore: a.passingScore,
    attemptedAt: a.attemptedAt.toISOString(),
  };
}
