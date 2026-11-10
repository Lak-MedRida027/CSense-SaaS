import { Types, trusted } from 'mongoose';
import {
  QUESTION_REMOVED_TEXT,
  revealPolicy,
  type AttemptDetailDTO,
  type AttemptListDTO,
  type ListAttemptsQuery,
  type ReviewItemDTO,
} from '@csense/shared';
import { notFoundError, validation } from '../../lib/httpError.js';
import { Assessment, QuizAttempt } from '../../models/index.js';
import { toObjectId } from './curriculum.service.js';
import { toAttemptSummary } from './learning.mapper.js';

/** A stored attempt as read from the database (lean or `toObject()`). */
export interface AttemptRecord {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: 'Quiz' | 'FinalTest';
  refId: Types.ObjectId;
  moduleId?: Types.ObjectId | null | undefined;
  answers: {
    questionId: Types.ObjectId;
    selectedIndex?: number | null | undefined;
    correct: boolean;
  }[];
  attemptNumber: number;
  endReason: 'submitted' | 'abandoned' | 'expired';
  score: number;
  passed: boolean;
  correctCount: number;
  totalCount: number;
  passingScore: number;
  attemptedAt: Date;
}

interface QuestionLookup {
  questions: {
    questionId: Types.ObjectId;
    text: string;
    options: string[];
    correctAnswer?: number;
    explanation?: string;
  }[];
}

/**
 * Review items follow the reveal policy (D3-13). The key is read from the database only when the
 * policy allows it to be shown, so a bug further down cannot leak what was never loaded.
 */
async function buildReview(attempt: AttemptRecord): Promise<ReviewItemDTO[]> {
  const assessmentPassed =
    attempt.passed ||
    (await QuizAttempt.exists({ userId: attempt.userId, refId: attempt.refId, passed: true })) !==
      null;
  const policy = revealPolicy(attempt, assessmentPassed);
  if (!policy.showCorrectness) return [];

  const extras = [
    ...(policy.showExplanation ? ['+questions.explanation'] : []),
    ...(policy.showCorrectOption ? ['+questions.correctAnswer'] : []),
  ].join(' ');
  const query = Assessment.findById(attempt.refId);
  const assessment = await (extras ? query.select(extras) : query).lean<QuestionLookup>();
  const byId = new Map((assessment?.questions ?? []).map((q) => [q.questionId.toHexString(), q]));

  return attempt.answers.map((answer): ReviewItemDTO => {
    const questionId = answer.questionId.toHexString();
    const selectedIndex = answer.selectedIndex ?? null;
    const q = byId.get(questionId);
    if (!q) {
      return {
        questionId,
        text: QUESTION_REMOVED_TEXT,
        options: [],
        selectedIndex,
        correct: answer.correct,
      };
    }
    return {
      questionId,
      text: q.text,
      options: [...q.options],
      selectedIndex,
      correct: answer.correct,
      ...(policy.showExplanation && q.explanation ? { explanation: q.explanation } : {}),
      ...(policy.showCorrectOption && typeof q.correctAnswer === 'number'
        ? { correctIndex: q.correctAnswer }
        : {}),
    };
  });
}

export async function buildAttemptDetail(attempt: AttemptRecord): Promise<AttemptDetailDTO> {
  return { ...toAttemptSummary(attempt), review: await buildReview(attempt) };
}

/** Newest first, cursor = the last attemptId of the previous page. Always scoped to the caller. */
export async function listAttempts(
  userId: string,
  query: ListAttemptsQuery,
): Promise<AttemptListDTO> {
  const owner = toObjectId(userId);
  const filter: Record<string, unknown> = { userId: owner };
  if (query.kind) filter.type = query.kind;
  if (query.moduleId) filter.moduleId = toObjectId(query.moduleId);

  if (query.before) {
    const cursor = await QuizAttempt.findOne({ _id: query.before, userId: owner })
      .select('attemptedAt')
      .lean();
    if (!cursor) {
      throw validation([{ location: 'query', path: 'before', message: 'is not a known attempt' }]);
    }
    filter.$or = [
      { attemptedAt: trusted({ $lt: cursor.attemptedAt }) },
      { attemptedAt: cursor.attemptedAt, _id: trusted({ $lt: cursor._id }) },
    ];
  }

  const rows = await QuizAttempt.find(filter)
    .sort({ attemptedAt: -1, _id: -1 })
    .limit(query.limit + 1)
    .lean<AttemptRecord[]>();
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((a) => toAttemptSummary(a)),
    nextCursor: rows.length > query.limit && last ? last._id.toHexString() : null,
  };
}

/** Another employee's attempt is indistinguishable from an unknown id: 404 either way. */
export async function getAttempt(userId: string, attemptId: string): Promise<AttemptDetailDTO> {
  const attempt = await QuizAttempt.findOne({
    _id: attemptId,
    userId: toObjectId(userId),
  }).lean<AttemptRecord>();
  if (!attempt) throw notFoundError();
  return buildAttemptDetail(attempt);
}
