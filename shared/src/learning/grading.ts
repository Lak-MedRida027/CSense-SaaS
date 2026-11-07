/**
 * Pure grading rules (ADR 0007). The server grades from the key snapshot stored in the session;
 * the client never supplies a score, a pass flag or a per-question verdict.
 */
export interface ServedQuestion {
  questionId: string;
  optionCount: number;
  correctAnswer: number;
}

export interface SubmittedAnswer {
  questionId: string;
  selectedIndex: number | null;
}

export interface AnswerIssue {
  /** Index into the submitted answers array. */
  index: number;
  field: 'questionId' | 'selectedIndex';
  reason: 'not_served' | 'duplicate' | 'out_of_range';
}

export interface GradedAnswer {
  questionId: string;
  selectedIndex: number | null;
  correct: boolean;
}

export interface GradedAttempt {
  /** One entry per served question, in served order. */
  answers: GradedAnswer[];
  correctCount: number;
  totalCount: number;
  score: number;
  passed: boolean;
}

/** `floor(100 * correct / total)` in exact integer arithmetic. */
export function computeScore(correct: number, total: number): number {
  if (!Number.isInteger(total) || total < 1) throw new Error('total must be an integer >= 1');
  if (!Number.isInteger(correct) || correct < 0 || correct > total) {
    throw new Error('correct must be an integer between 0 and total');
  }
  const scaled = 100 * correct;
  return (scaled - (scaled % total)) / total;
}

/** For an integer threshold this equals the exact test `100 * correct >= passingScore * total`. */
export function isPass(score: number, passingScore: number): boolean {
  return score >= passingScore;
}

/** Problems with a submission relative to what was served. Empty means gradeable. */
export function validateAnswers(
  served: readonly ServedQuestion[],
  answers: readonly SubmittedAnswer[],
): AnswerIssue[] {
  const byId = new Map(served.map((q) => [q.questionId, q]));
  const seen = new Set<string>();
  const issues: AnswerIssue[] = [];
  answers.forEach((answer, index) => {
    const question = byId.get(answer.questionId);
    if (!question) {
      issues.push({ index, field: 'questionId', reason: 'not_served' });
      return;
    }
    if (seen.has(answer.questionId)) {
      issues.push({ index, field: 'questionId', reason: 'duplicate' });
      return;
    }
    seen.add(answer.questionId);
    const s = answer.selectedIndex;
    if (s !== null && (!Number.isInteger(s) || s < 0 || s >= question.optionCount)) {
      issues.push({ index, field: 'selectedIndex', reason: 'out_of_range' });
    }
  });
  return issues;
}

/**
 * Grade a submission against the served snapshot. Unanswered (null or missing) counts as wrong.
 * Answers for unserved ids are ignored here; call `validateAnswers` first to reject them.
 */
export function gradeAttempt(
  served: readonly ServedQuestion[],
  answers: readonly SubmittedAnswer[],
  passingScore: number,
): GradedAttempt {
  if (served.length === 0) throw new Error('cannot grade an empty question set');
  const chosen = new Map<string, number | null>();
  for (const a of answers) if (!chosen.has(a.questionId)) chosen.set(a.questionId, a.selectedIndex);

  const graded = served.map((q): GradedAnswer => {
    const selectedIndex = chosen.get(q.questionId) ?? null;
    return { questionId: q.questionId, selectedIndex, correct: selectedIndex === q.correctAnswer };
  });
  const correctCount = graded.filter((a) => a.correct).length;
  const totalCount = served.length;
  const score = computeScore(correctCount, totalCount);
  return { answers: graded, correctCount, totalCount, score, passed: isPass(score, passingScore) };
}
