import { trusted, type Types } from 'mongoose';
import type {
  ExerciseFeedbackDTO,
  LearningOverviewDTO,
  ModuleDetailDTO,
  ModuleProgressDTO,
} from '@csense/shared';
import { contentIncomplete, moduleLocked, notFoundError, validation } from '../../lib/httpError.js';
import { Module, UserProgress } from '../../models/index.js';
import {
  toObjectId,
  loadLearningState,
  type CurriculumEntry,
  type LearningState,
} from './curriculum.service.js';
import type { LearningDeps } from './deps.js';
import {
  toFinalTestStatus,
  toModuleProgress,
  toModuleSummary,
  toQuizOverview,
} from './learning.mapper.js';
import { ensureProgress } from './progress.store.js';

/**
 * Resolve a module the employee may open: unknown or unpublished is 404 (drafts are not
 * disclosed), a module beyond the frontier is 403 MODULE_LOCKED (ADR 0006).
 */
export function requireModuleAccess(state: LearningState, moduleId: string): CurriculumEntry {
  const entry = state.entryById.get(moduleId);
  if (!entry) throw notFoundError();
  const derived = state.stateById.get(moduleId);
  if (!derived || derived.status === 'locked') throw moduleLocked();
  return entry;
}

export async function getOverview(userId: string): Promise<LearningOverviewDTO> {
  const state = await loadLearningState(userId);
  const frontier = state.states.find((s) => s.status === 'unlocked' || s.status === 'in_progress');
  return {
    modules: state.curriculum.map((entry) => toModuleSummary(state, entry)),
    totalModules: state.curriculum.length,
    completedCount: state.states.filter((s) => s.status === 'completed').length,
    nextModuleId: frontier?.moduleId ?? null,
    finalTest: state.finalTest ? toFinalTestStatus(state, state.finalTest) : null,
  };
}

interface ModuleContentDoc {
  content: string;
  videoUrl?: string | null;
  captionsUrl?: string | null;
  transcript: { startSeconds: number; text: string }[];
  keyTakeaways: string[];
  exercises: {
    exerciseId: Types.ObjectId;
    prompt: string;
    artifact?: string | null;
    options: string[];
  }[];
}

export async function getModuleDetail(
  deps: LearningDeps,
  userId: string,
  moduleId: string,
): Promise<ModuleDetailDTO> {
  const state = await loadLearningState(userId);
  const entry = requireModuleAccess(state, moduleId);

  // No explicit projection: `correctAnswer` and `explanation` are select:false and stay out.
  const doc = await Module.findOne({ _id: moduleId, isPublished: true }).lean<ModuleContentDoc>();
  if (!doc) throw notFoundError();

  const quiz = state.quizzes.get(moduleId);
  return {
    module: toModuleSummary(state, entry),
    content: {
      body: doc.content,
      keyTakeaways: [...doc.keyTakeaways],
      video: doc.videoUrl
        ? {
            url: doc.videoUrl,
            captionsUrl: doc.captionsUrl ?? null,
            transcript: doc.transcript.map((cue, id) => ({
              id,
              startSeconds: cue.startSeconds,
              text: cue.text,
            })),
          }
        : null,
      exercises: doc.exercises.map((ex) => ({
        exerciseId: ex.exerciseId.toHexString(),
        prompt: ex.prompt,
        artifact: ex.artifact ?? null,
        options: [...ex.options],
      })),
    },
    progress: toModuleProgress(state, moduleId, state.progress.get(moduleId)),
    quiz: quiz ? toQuizOverview(state, moduleId, quiz, deps.clock()) : null,
  };
}

async function progressFor(userId: string, moduleId: string): Promise<ModuleProgressDTO> {
  const state = await loadLearningState(userId);
  return toModuleProgress(state, moduleId, state.progress.get(moduleId));
}

/** Idempotent: the first call creates the row, later calls change nothing. */
export async function startModule(
  deps: LearningDeps,
  userId: string,
  moduleId: string,
): Promise<ModuleProgressDTO> {
  const state = await loadLearningState(userId);
  requireModuleAccess(state, moduleId);
  await ensureProgress(userId, moduleId, deps.clock());
  return progressFor(userId, moduleId);
}

interface ExerciseKeyDoc {
  exercises: {
    exerciseId: Types.ObjectId;
    options: string[];
    correctAnswer: number;
    explanation: string;
  }[];
}

/**
 * Immediate feedback for an interactive exercise (N2). The key and explanation leave the server
 * only here, after the employee has committed an answer. Only the first answer is recorded.
 */
export async function answerExercise(
  deps: LearningDeps,
  userId: string,
  moduleId: string,
  exerciseId: string,
  selectedIndex: number,
): Promise<ExerciseFeedbackDTO> {
  const state = await loadLearningState(userId);
  requireModuleAccess(state, moduleId);

  const doc = await Module.findOne({ _id: moduleId, isPublished: true })
    .select('+exercises.correctAnswer +exercises.explanation')
    .lean<ExerciseKeyDoc>();
  const exercise = doc?.exercises.find((e) => e.exerciseId.toHexString() === exerciseId);
  if (!exercise) throw notFoundError();
  if (selectedIndex >= exercise.options.length) {
    throw validation([
      { location: 'body', path: 'selectedIndex', message: 'is not an option of this exercise' },
    ]);
  }

  const correct = selectedIndex === exercise.correctAnswer;
  const now = deps.clock();
  await ensureProgress(userId, moduleId, now);
  const result = await UserProgress.updateOne(
    {
      userId: toObjectId(userId),
      moduleId: toObjectId(moduleId),
      'exerciseAnswers.exerciseId': trusted({ $ne: exercise.exerciseId }),
    },
    {
      $push: {
        exerciseAnswers: {
          exerciseId: exercise.exerciseId,
          selectedIndex,
          correct,
          answeredAt: now,
        },
      },
    },
  );

  return {
    exerciseId,
    selectedIndex,
    correct,
    correctIndex: exercise.correctAnswer,
    explanation: exercise.explanation,
    recorded: result.modifiedCount === 1,
  };
}

/**
 * The client reports the lesson finished. Every exercise must already have an answer. For video
 * modules the report cannot be verified; this gate is not a security boundary (ADR 0006).
 */
export async function completeContent(
  deps: LearningDeps,
  userId: string,
  moduleId: string,
): Promise<ModuleProgressDTO> {
  const state = await loadLearningState(userId);
  requireModuleAccess(state, moduleId);

  const doc = await Module.findOne({ _id: moduleId, isPublished: true })
    .select('exercises.exerciseId')
    .lean<{ exercises: { exerciseId: Types.ObjectId }[] }>();
  if (!doc) throw notFoundError();

  const now = deps.clock();
  await ensureProgress(userId, moduleId, now);
  const row = await UserProgress.findOne({
    userId: toObjectId(userId),
    moduleId: toObjectId(moduleId),
  }).lean();
  const answered = new Set((row?.exerciseAnswers ?? []).map((a) => a.exerciseId.toHexString()));
  if (!doc.exercises.every((e) => answered.has(e.exerciseId.toHexString()))) {
    throw contentIncomplete('Answer every exercise before finishing the module content');
  }

  // Keeps the first completion time; a repeat matches nothing.
  await UserProgress.updateOne(
    { userId: toObjectId(userId), moduleId: toObjectId(moduleId), contentCompletedAt: null },
    { $set: { contentCompletedAt: now } },
  );
  return progressFor(userId, moduleId);
}
