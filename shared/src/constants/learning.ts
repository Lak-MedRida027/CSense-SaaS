/** Limits and tunables for the learning engine (Phase 3, ADR 0006/0007). */
export const MAX_ANSWERS_PER_SUBMISSION = 100;
/** Highest legal option index in a request (MAX_OPTIONS - 1). */
export const MAX_OPTIONS = 6;
export const MAX_EXERCISES = 20;
export const MAX_TRANSCRIPT_CUES = 500;
export const MAX_KEY_TAKEAWAYS = 10;

/** Authoring targets used by the seed (client needs: about 5 per quiz, about 15 final). */
/** Questions served per session (P3-M1): a quiz serves 5, the final test 15. */
export const QUIZ_QUESTIONS_PER_SESSION = 5;
export const FINAL_TEST_QUESTIONS_PER_SESSION = 15;
/** A published pool holds at least this many times the questions served per session. */
export const MIN_POOL_FACTOR = 2;
export const MODULE_QUIZ_TARGET_QUESTIONS = QUIZ_QUESTIONS_PER_SESSION * MIN_POOL_FACTOR;
export const FINAL_TEST_TARGET_QUESTIONS = FINAL_TEST_QUESTIONS_PER_SESSION * MIN_POOL_FACTOR;

export const ATTEMPT_END_REASONS = ['submitted', 'abandoned', 'expired'] as const;
export type AttemptEndReason = (typeof ATTEMPT_END_REASONS)[number];

export const SESSION_STATUSES = ['open', 'submitted', 'abandoned', 'expired'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const QUIZ_BLOCKED_REASONS = [
  'module_locked',
  'content_incomplete',
  'already_passed',
  'quiz_unavailable',
  'cooldown',
] as const;
export type QuizBlockedReason = (typeof QUIZ_BLOCKED_REASONS)[number];

/** Shown in a review when the question was removed after the attempt. */
export const QUESTION_REMOVED_TEXT = 'This question is no longer available';
