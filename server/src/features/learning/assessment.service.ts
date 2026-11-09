import { Types, trusted } from 'mongoose';
import { AttemptCounter } from '../../models/index.js';
import {
  gradeAttempt,
  selectQuestionIds,
  validateAnswers,
  type AnswerIssue,
  type AssessmentKind,
  type AssessmentSessionDTO,
  type AttemptEndReason,
  type AttemptResultDTO,
  type FinalTestOverviewDTO,
  type GradedAttempt,
  type QuizOverviewDTO,
  type ServedQuestion,
  type SubmitAttemptRequest,
} from '@csense/shared';
import {
  alreadyPassed,
  assessmentCooldown,
  conflict,
  contentIncomplete,
  finalTestLocked,
  notFoundError,
  sessionClosed,
  sessionExpired,
  validation,
} from '../../lib/httpError.js';
import { Assessment, AssessmentSession, QuizAttempt } from '../../models/index.js';
import { buildAttemptDetail, type AttemptRecord } from './attempts.service.js';
import {
  loadLearningState,
  toObjectId,
  type AssessmentSummary,
  type LearningState,
} from './curriculum.service.js';
import type { LearningDeps, RequestInfo } from './deps.js';
import { activeCooldown, toFinalTestOverview, toQuizOverview } from './learning.mapper.js';
import type { AttemptEffects } from './learningHooks.js';
import { requireModuleAccess } from './modules.service.js';
import { audit } from '../audit/audit.service.js';
import {
  allocateAttemptNumber,
  claimFirstPass,
  releaseAttemptNumber,
  reserveAttemptNumber,
  countOnLedger,
  startCooldownIfDue,
} from './ledger.store.js';
import { markFirstPass, recordAttemptOnProgress } from './progress.store.js';

export type AssessmentTarget = { kind: 'Quiz'; moduleId: string } | { kind: 'FinalTest' };

interface ResolvedTarget {
  kind: AssessmentKind;
  moduleId: string | null;
  assessment: AssessmentSummary;
  state: LearningState;
  alreadyPassed: boolean;
}

/**
 * Resolve the route's assessment and enforce the lock. Access is derived fresh from the database
 * on every call (start, submit, abandon), never remembered from an earlier request.
 */
async function resolveTarget(userId: string, target: AssessmentTarget): Promise<ResolvedTarget> {
  const state = await loadLearningState(userId);
  if (target.kind === 'Quiz') {
    requireModuleAccess(state, target.moduleId);
    const assessment = state.quizzes.get(target.moduleId);
    if (!assessment) throw notFoundError();
    return {
      kind: 'Quiz',
      moduleId: target.moduleId,
      assessment,
      state,
      alreadyPassed: state.progress.get(target.moduleId)?.quizPassed === true,
    };
  }
  if (!state.finalTest) throw notFoundError();
  if (state.finalState.status === 'locked') throw finalTestLocked();
  return {
    kind: 'FinalTest',
    moduleId: null,
    assessment: state.finalTest,
    state,
    alreadyPassed: state.finalStats.passed,
  };
}

export async function getQuizOverview(
  deps: LearningDeps,
  userId: string,
  moduleId: string,
): Promise<QuizOverviewDTO> {
  const state = await loadLearningState(userId);
  requireModuleAccess(state, moduleId);
  const quiz = state.quizzes.get(moduleId);
  if (!quiz) throw notFoundError();
  return toQuizOverview(state, moduleId, quiz, deps.clock());
}

export async function getFinalTestOverview(
  deps: LearningDeps,
  userId: string,
): Promise<FinalTestOverviewDTO> {
  const state = await loadLearningState(userId);
  if (!state.finalTest) throw notFoundError();
  return toFinalTestOverview(state, state.finalTest, deps.clock());
}

// --- Sessions ---------------------------------------------------------------------------------

interface SessionRecord {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  kind: AssessmentKind;
  assessmentId: Types.ObjectId;
  moduleId?: Types.ObjectId | null | undefined;
  status: string;
  questions: { questionId: Types.ObjectId; optionCount: number; correctAnswer?: number }[];
  passingScore: number;
  attemptNumber?: number | null | undefined;
  startedAt?: Date | undefined;
  expiresAt: Date;
}

interface AssessmentWithKeys {
  title: string;
  passingScore: number;
  questionsPerSession?: number | null;
  questions: {
    questionId: Types.ObjectId;
    text: string;
    options: string[];
    correctAnswer: number;
  }[];
}

const isDuplicateKey = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;

export async function startSession(
  deps: LearningDeps,
  userId: string,
  target: AssessmentTarget,
  info: RequestInfo,
): Promise<AssessmentSessionDTO> {
  const resolved = await resolveTarget(userId, target);
  if (resolved.alreadyPassed) throw alreadyPassed();
  if (resolved.kind === 'Quiz' && resolved.moduleId !== null) {
    const row = resolved.state.progress.get(resolved.moduleId);
    if (!row?.contentCompletedAt) throw contentIncomplete();
  }
  if (resolved.assessment.questionCount < 1) throw notFoundError();

  const assessmentId = resolved.assessment.id;
  const now = deps.clock();
  const owner = toObjectId(userId);
  const assessmentOid = toObjectId(assessmentId);

  const open = await AssessmentSession.findOne({
    userId: owner,
    assessmentId: assessmentOid,
    status: 'open',
  }).lean<SessionRecord>();

  // Idempotent start (P3-L6): a repeat inside the reuse window (double click, retry after a
  // timeout) gets the session it already has instead of burning an attempt.
  if (
    open?.startedAt &&
    // Only a session that already owns its attempt number is handed out again: until the
    // reservation succeeds the start may still be refused by the cooldown gate.
    open.attemptNumber != null &&
    deps.startReuseSeconds > 0 &&
    now.getTime() < open.expiresAt.getTime() &&
    now.getTime() - open.startedAt.getTime() < deps.startReuseSeconds * 1000
  ) {
    const reused = await toSessionDto(open, resolved, await loadServedContent(assessmentId));
    if (reused) return reused;
  }

  // Cooldown after repeated failures (P3-M1): checked before anything is changed ...
  const cooling = activeCooldown(resolved.state, assessmentId, now);
  if (cooling) throw assessmentCooldown(cooling, now);

  // Leaving a quiz counts as an attempt (D5): close a session that is still open.
  if (open) {
    const reason = now.getTime() >= open.expiresAt.getTime() ? 'expired' : 'abandoned';
    await finalizeSession(
      deps,
      open,
      { endReason: reason, graded: null, guardExpiry: false },
      info,
    );
  }

  // ... and again after closing the open session, because that abandonment is itself a failure.
  if (open) {
    const counter = await AttemptCounter.findOne({ userId: owner, assessmentId: assessmentOid })
      .select('cooldownUntil')
      .lean();
    if (counter?.cooldownUntil && counter.cooldownUntil.getTime() > now.getTime()) {
      throw assessmentCooldown(counter.cooldownUntil, now);
    }
  }

  const doc = await Assessment.findById(assessmentId)
    .select('+questions.correctAnswer')
    .lean<AssessmentWithKeys>();
  if (!doc || doc.questions.length === 0) throw notFoundError();

  // Serve a subset of the pool, preferring questions this employee has not been served before.
  const earlier = await QuizAttempt.find({ userId: owner, refId: assessmentOid })
    .select('answers.questionId')
    .sort({ attemptedAt: -1, _id: -1 })
    .limit(100)
    .lean();
  const history = earlier.reverse().map((a) => a.answers.map((x) => x.questionId.toHexString()));
  const byId = new Map(doc.questions.map((q) => [q.questionId.toHexString(), q]));
  const chosen = selectQuestionIds(
    [...byId.keys()],
    history,
    doc.questionsPerSession ?? doc.questions.length,
    deps.shuffle,
  );
  const order = chosen.map((id) => byId.get(id) as NonNullable<ReturnType<typeof byId.get>>);
  let session;
  try {
    session = await AssessmentSession.create({
      userId: owner,
      kind: resolved.kind,
      assessmentId: assessmentOid,
      moduleId: resolved.moduleId === null ? null : toObjectId(resolved.moduleId),
      status: 'open',
      questions: order.map((q) => ({
        questionId: q.questionId,
        optionCount: q.options.length,
        correctAnswer: q.correctAnswer,
      })),
      passingScore: doc.passingScore,
      startedAt: now,
      expiresAt: new Date(now.getTime() + deps.sessionTtlSeconds * 1000),
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('A session for this assessment was just started');
    throw err;
  }

  // Second guard (P3-L3): the partial unique index is the primary protection, but it is verified
  // only at startup. If two starts ever both succeed, the lowest id keeps the session and every
  // other open one is closed, so at most one session is usable whatever the index state.
  const rivals = await AssessmentSession.find({
    userId: owner,
    assessmentId: assessmentOid,
    status: 'open',
  })
    .select('_id')
    .sort({ _id: 1 })
    .limit(50)
    .lean();
  const winner = rivals[0];
  if (winner && !winner._id.equals(session._id)) {
    await AssessmentSession.updateOne(
      { _id: session._id, status: 'open', attemptNumber: null },
      { $set: { status: 'abandoned', closedAt: now } },
    );
    throw conflict('A session for this assessment was just started');
  }
  if (rivals.length > 1) {
    // Other open sessions can only exist if the unique index was missing. A rival may already be
    // numbered and served, so it is closed through the normal path (an unnumbered one silently, a
    // numbered one as a recorded abandoned attempt), never by a blind update.
    const others = await AssessmentSession.find({
      userId: owner,
      assessmentId: assessmentOid,
      status: 'open',
      _id: trusted({ $ne: session._id }),
    }).lean<SessionRecord[]>();
    for (const rival of others) {
      await finalizeSession(
        deps,
        rival,
        { endReason: 'abandoned', graded: null, guardExpiry: false },
        info,
      );
    }
  }

  // The attempt number is reserved only now that this start owns the one open session (P3-L11),
  // so a start that lost a race never consumes a number and numbering stays dense. The same
  // conditional update refuses the reservation while a cooldown runs or the failure streak is at
  // the limit (P3-L10), so a start cannot slip in between the last failure and the cooldown write.
  const reservation = await reserveAttemptNumber(userId, assessmentId, {
    afterFails: deps.cooldownAfterFails,
    minutes: deps.cooldownMinutes,
    now,
  });
  if ('blockedUntil' in reservation) {
    await AssessmentSession.updateOne(
      { _id: session._id, status: 'open', attemptNumber: null },
      { $set: { status: 'abandoned', closedAt: now } },
    );
    throw assessmentCooldown(reservation.blockedUntil, now);
  }
  const attemptNumber = reservation.attemptNumber;
  const bound = await AssessmentSession.updateOne(
    { _id: session._id, status: 'open' },
    { $set: { attemptNumber } },
  );
  if (bound.matchedCount === 0) {
    // Another start closed this session between its creation and the reservation: it is dead, so
    // hand the number back (possible while nobody drew a later one) and report the lost race.
    await releaseAttemptNumber(userId, assessmentId, attemptNumber);
    throw conflict('A session for this assessment was just started');
  }

  // Whitelist: text and options only. The key and the explanation stay on the server.
  return {
    sessionId: session.id,
    kind: resolved.kind,
    assessmentId,
    moduleId: resolved.moduleId,
    title: doc.title,
    passingScore: doc.passingScore,
    attemptNumber,
    startedAt: now.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    questions: order.map((q) => ({
      questionId: q.questionId.toHexString(),
      text: q.text,
      options: [...q.options],
    })),
  };
}

interface ServedContent {
  title: string;
  questions: { questionId: Types.ObjectId; text: string; options: string[] }[];
}

/** Question text and options only (the default projection hides keys and explanations). */
async function loadServedContent(assessmentId: string): Promise<ServedContent | null> {
  return Assessment.findById(assessmentId).lean<ServedContent>();
}

/** Rebuild the DTO of an open session; null when its questions no longer exist as served. */
async function toSessionDto(
  session: SessionRecord,
  resolved: ResolvedTarget,
  content: ServedContent | null,
): Promise<AssessmentSessionDTO | null> {
  if (!content || !session.startedAt) return null;
  const byId = new Map(content.questions.map((q) => [q.questionId.toHexString(), q]));
  const questions = session.questions.map((q) => byId.get(q.questionId.toHexString()));
  if (questions.some((q) => q === undefined)) return null;
  const attemptNumber =
    session.attemptNumber ??
    (await QuizAttempt.countDocuments({ userId: session.userId, refId: session.assessmentId })) + 1;
  return {
    sessionId: session._id.toHexString(),
    kind: resolved.kind,
    assessmentId: resolved.assessment.id,
    moduleId: resolved.moduleId,
    title: content.title,
    passingScore: session.passingScore,
    attemptNumber,
    startedAt: session.startedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    questions: questions.map((q) => ({
      questionId: (q as NonNullable<typeof q>).questionId.toHexString(),
      text: (q as NonNullable<typeof q>).text,
      options: [...(q as NonNullable<typeof q>).options],
    })),
  };
}

// --- Closing a session (submit, abandon, expiry) ----------------------------------------------

interface FinalizeInput {
  endReason: AttemptEndReason;
  /** Null for abandoned and expired: every served question is recorded as unanswered. */
  graded: GradedAttempt | null;
  /** Submissions must also be inside the time limit at the moment of the claim. */
  guardExpiry: boolean;
}

interface Finalized {
  attempt: AttemptRecord;
  firstPass: boolean;
  effects: AttemptEffects;
}

/** Only these hook outputs reach the response (strict response schema). */
function pickEffects(raw: AttemptEffects | undefined): AttemptEffects {
  const out: AttemptEffects = {};
  if (!raw) return out;
  if (typeof raw.xpEarned === 'number' && Number.isInteger(raw.xpEarned) && raw.xpEarned >= 0) {
    out.xpEarned = raw.xpEarned;
  }
  const badge = raw.badge;
  if (
    badge &&
    typeof badge.id === 'string' &&
    typeof badge.name === 'string' &&
    typeof badge.iconMotif === 'string'
  ) {
    out.badge = { id: badge.id, name: badge.name, iconMotif: badge.iconMotif };
  }
  return out;
}

/** Run an idempotent write once more if it fails, so a transient error does not lose the pass. */
async function retried<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch {
    return run();
  }
}

/**
 * Run one hook with a time limit (P3-L5). A hook that throws or exceeds `hookTimeoutMs` is logged
 * and its effects are dropped; the attempt is already saved and the response still returns.
 */
async function runHook(
  deps: LearningDeps,
  info: RequestInfo,
  name: string,
  call: () => Promise<AttemptEffects | undefined>,
): Promise<AttemptEffects> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      resolve('timeout');
    }, deps.hookTimeoutMs);
  });
  try {
    const pending = call();
    // A hook that settles after the limit must not become an unhandled rejection.
    pending.catch(() => undefined);
    const outcome = await Promise.race([pending, limit]);
    if (outcome === 'timeout') {
      deps.logger.error(
        { requestId: info.requestId, hook: name, timeoutMs: deps.hookTimeoutMs },
        'Learning hook timed out; its effects were dropped',
      );
      return {};
    }
    return pickEffects(outcome);
  } catch (err) {
    // The attempt is already committed; it must not be reported as failed (ADR 0008).
    deps.logger.error({ err, requestId: info.requestId, hook: name }, 'Learning hook failed');
    return {};
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Block new sessions after repeated failures and tell the security team (P3-M1). The audit entry is
 * the "flag" Phase 4 feeds into the Behavioural risk dimension; it carries the user, the assessment
 * and the streak length, never answers or scores. A failed audit write is logged, not thrown: the
 * attempt is already saved and the cooldown is already in force.
 */
async function startCooldown(
  deps: LearningDeps,
  info: RequestInfo,
  session: SessionRecord,
  streak: number,
  now: Date,
  attemptNumber: number,
): Promise<void> {
  const userHex = session.userId.toHexString();
  const assessmentHex = session.assessmentId.toHexString();
  const until = await retried(() =>
    startCooldownIfDue(userHex, assessmentHex, streak, {
      afterFails: deps.cooldownAfterFails,
      minutes: deps.cooldownMinutes,
      now,
    }),
  );
  if (!until) return;
  try {
    await audit.record({
      action: 'learning.assessment.cooldown',
      outcome: 'success',
      severity: 'warning',
      actor: { id: userHex, role: 'employee' },
      target: { type: 'user', id: userHex },
      ctx: { requestId: info.requestId },
      metadata: {
        assessmentId: assessmentHex,
        kind: session.kind,
        failedAttempts: deps.cooldownAfterFails,
        attemptNumber,
        cooldownMinutes: deps.cooldownMinutes,
        until: until.toISOString(),
      },
    });
  } catch (err) {
    deps.logger.error({ err, requestId: info.requestId }, 'Cooldown audit entry failed');
  }
}

/**
 * Steps 9 to 12 of the submit algorithm (plan 5.4): claim the session atomically, insert one
 * append-only attempt, update progress, then run the hooks. Returns null when another request
 * closed the session first (replay or race loser). Writes are ordered, not transactional
 * (ADR 0007): the worst partial failure loses one attempt, it never credits an unearned pass.
 */
async function finalizeSession(
  deps: LearningDeps,
  session: SessionRecord,
  input: FinalizeInput,
  info: RequestInfo,
): Promise<Finalized | null> {
  const now = deps.clock();
  // A session without an attempt number was never admitted by the start gate and never returned to
  // any client (start answers only after the reservation, and the reuse path skips such sessions).
  // Closing it, for any reason, is therefore not an attempt: no number is drawn, no attempt is
  // written, and the failure streak and cooldown are left alone. It is only marked closed.
  if (session.attemptNumber == null) {
    const silent = await AssessmentSession.updateOne(
      { _id: session._id, userId: session.userId, status: 'open', attemptNumber: null },
      { $set: { status: 'abandoned', closedAt: now } },
    );
    if (silent.matchedCount === 1) return null;
    // The start numbered (and served) the session after this snapshot was read, or somebody closed
    // it. Decide from the current document, never from the stale snapshot: a numbered session is a
    // real attempt and takes the normal path below.
    const fresh = await AssessmentSession.findOne({ _id: session._id, userId: session.userId })
      .select('+questions.correctAnswer')
      .lean<SessionRecord>();
    if (fresh?.status !== 'open' || fresh.attemptNumber == null) return null;
    session = fresh;
  }
  const claim = await AssessmentSession.findOneAndUpdate(
    {
      _id: session._id,
      userId: session.userId,
      status: 'open',
      ...(input.guardExpiry ? { expiresAt: trusted({ $gt: now }) } : {}),
    },
    { $set: { status: input.endReason, closedAt: now } },
  );
  if (!claim) return null;

  const graded = input.graded;
  const answers = graded
    ? graded.answers
    : session.questions.map((q) => ({
        questionId: q.questionId.toHexString(),
        selectedIndex: null,
        correct: false,
      }));
  const score = graded?.score ?? 0;
  const passed = graded?.passed ?? false;
  const kind = session.kind;
  const moduleId = session.moduleId ?? null;

  const userHex = session.userId.toHexString();
  const assessmentHex = session.assessmentId.toHexString();

  // The number was reserved atomically when the session started (P3-L2).
  if (session.attemptNumber == null) return null; // unreachable: handled above
  let attemptNumber: number = session.attemptNumber;
  const insertAttempt = async (): Promise<AttemptRecord> => {
    const created = await QuizAttempt.create({
      userId: session.userId,
      type: kind,
      refId: session.assessmentId,
      answers: answers.map((a) => ({
        questionId: toObjectId(a.questionId),
        selectedIndex: a.selectedIndex,
        correct: a.correct,
      })),
      score,
      passed,
      sessionId: session._id,
      moduleId,
      attemptNumber,
      endReason: input.endReason,
      correctCount: graded?.correctCount ?? 0,
      totalCount: session.questions.length,
      passingScore: session.passingScore,
    });
    return created.toObject();
  };

  let attempt: AttemptRecord;
  try {
    try {
      attempt = await insertAttempt();
    } catch (err) {
      const pattern = (err as { keyPattern?: Record<string, unknown> }).keyPattern;
      // Only the attempt-number index collided (a stale or planted number): take a fresh one.
      if (!isDuplicateKey(err) || pattern?.sessionId !== undefined || !pattern?.attemptNumber) {
        throw err;
      }
      attemptNumber = await allocateAttemptNumber(userHex, assessmentHex);
      attempt = await insertAttempt();
    }
  } catch (err) {
    if (isDuplicateKey(err)) return null; // the unique sessionId already has its attempt
    // Give the session back so the employee can retry instead of losing the attempt.
    await AssessmentSession.updateOne(
      { _id: session._id, status: input.endReason },
      { $set: { status: 'open', closedAt: null } },
    ).catch((revertErr: unknown) => {
      deps.logger.error({ err: revertErr, requestId: info.requestId }, 'Session revert failed');
    });
    throw err;
  }

  // From here on the attempt is saved. No failure below may turn into a 500 or lose the pass:
  // writes are retried, then logged, and the next read repairs progress from the history (P3-L1).
  const submitted = input.endReason === 'submitted';
  let firstPass = false;
  try {
    const streak = await retried(() =>
      countOnLedger(userHex, assessmentHex, { attemptNumber, score, submitted, passed, at: now }),
    );
    if (passed) firstPass = await retried(() => claimFirstPass(userHex, assessmentHex, now));
    else await startCooldown(deps, info, session, streak, now, attemptNumber);
  } catch (err) {
    deps.logger.error(
      { err, requestId: info.requestId },
      'Ledger update failed after attempt saved',
    );
  }
  if (kind === 'Quiz' && moduleId !== null) {
    try {
      await retried(() =>
        recordAttemptOnProgress(userHex, moduleId.toHexString(), { score, submitted, at: now }),
      );
      if (passed) await retried(() => markFirstPass(userHex, moduleId.toHexString(), now));
    } catch (err) {
      deps.logger.error(
        { err, requestId: info.requestId, attemptId: attempt._id.toHexString() },
        'Progress update failed after attempt saved; it will be repaired from the attempt history',
      );
    }
  }

  const userId = session.userId.toHexString();
  const attemptId = attempt._id.toHexString();
  const effects: AttemptEffects = {};
  const merge = (e: AttemptEffects): void => {
    if (e.xpEarned !== undefined) effects.xpEarned = (effects.xpEarned ?? 0) + e.xpEarned;
    if (e.badge) effects.badge = e.badge;
  };

  merge(
    await runHook(deps, info, 'onAttemptRecorded', () =>
      deps.hooks.onAttemptRecorded({
        userId,
        attemptId,
        kind,
        assessmentId: session.assessmentId.toHexString(),
        moduleId: moduleId ? moduleId.toHexString() : null,
        attemptNumber: attempt.attemptNumber,
        endReason: input.endReason,
        score,
        passed,
        correctCount: graded?.correctCount ?? 0,
        totalCount: session.questions.length,
        at: now,
      }),
    ),
  );
  if (firstPass && kind === 'Quiz' && moduleId !== null) {
    merge(
      await runHook(deps, info, 'onModuleCompleted', () =>
        deps.hooks.onModuleCompleted({
          userId,
          moduleId: moduleId.toHexString(),
          attemptId,
          attemptNumber: attempt.attemptNumber,
          score,
          at: now,
        }),
      ),
    );
  } else if (firstPass && kind === 'FinalTest') {
    merge(
      await runHook(deps, info, 'onFinalTestPassed', () =>
        deps.hooks.onFinalTestPassed({
          userId,
          assessmentId: session.assessmentId.toHexString(),
          attemptId,
          attemptNumber: attempt.attemptNumber,
          score,
          at: now,
        }),
      ),
    );
  }

  return { attempt, firstPass, effects };
}

async function buildResult(userId: string, done: Finalized): Promise<AttemptResultDTO> {
  const after = await loadLearningState(userId);
  const moduleCompleted = done.attempt.type === 'Quiz' && done.attempt.passed;
  const frontier = after.states.find((s) => s.status !== 'completed');
  return {
    ...(await buildAttemptDetail(done.attempt)),
    progression: {
      moduleCompleted,
      nextModuleId: moduleCompleted ? (frontier?.moduleId ?? null) : null,
      finalTestUnlocked: after.finalState.status !== 'locked',
    },
    effects: done.effects,
  };
}

const ISSUE_MESSAGES: Record<AnswerIssue['reason'], string> = {
  not_served: 'was not served in this session',
  duplicate: 'is repeated',
  out_of_range: 'is not an option of this question',
};

/** Load the caller's own session for this assessment. Anything else is 404. */
async function loadOwnSession(
  userId: string,
  assessmentId: string,
  sessionId: string,
): Promise<SessionRecord> {
  const session = await AssessmentSession.findOne({
    _id: sessionId,
    userId: toObjectId(userId),
    assessmentId: toObjectId(assessmentId),
  })
    .select('+questions.correctAnswer')
    .lean<SessionRecord>();
  if (!session) throw notFoundError();
  return session;
}

export async function submitAttempt(
  deps: LearningDeps,
  userId: string,
  target: AssessmentTarget,
  body: SubmitAttemptRequest,
  info: RequestInfo,
): Promise<AttemptResultDTO> {
  const resolved = await resolveTarget(userId, target);
  const session = await loadOwnSession(userId, resolved.assessment.id, body.sessionId);

  if (session.status !== 'open') {
    deps.logger.warn(
      { requestId: info.requestId, sessionId: body.sessionId },
      'Replay on a closed session',
    );
    throw sessionClosed();
  }
  const now = deps.clock();
  if (now.getTime() >= session.expiresAt.getTime()) {
    deps.logger.warn(
      { requestId: info.requestId, sessionId: body.sessionId },
      'Submission after expiry',
    );
    const expired = await finalizeSession(
      deps,
      session,
      { endReason: 'expired', graded: null, guardExpiry: false },
      info,
    );
    if (!expired) throw sessionClosed();
    throw sessionExpired();
  }

  // A running cooldown also stops a session that was opened before it began (P3-L10). Abandoning
  // stays possible and is counted as a failure.
  // The ledger is read fresh here, and a streak at the limit counts as a cooldown that is about to
  // be written, so a session whose start is still being refused cannot be graded in that window.
  const ledger = await AttemptCounter.findOne({
    userId: toObjectId(userId),
    assessmentId: toObjectId(resolved.assessment.id),
  })
    .select('consecutiveFails cooldownUntil')
    .lean();
  if (ledger?.cooldownUntil && ledger.cooldownUntil.getTime() > now.getTime()) {
    throw assessmentCooldown(ledger.cooldownUntil, now);
  }
  if (ledger && ledger.consecutiveFails >= deps.cooldownAfterFails) {
    throw assessmentCooldown(new Date(now.getTime() + 5000), now);
  }

  // Re-checked at submit time (P3-L2): a pass committed since this session started closes it.
  if (resolved.alreadyPassed) throw alreadyPassed();

  const served: ServedQuestion[] = session.questions.map((q) => {
    if (typeof q.correctAnswer !== 'number') throw new Error('session snapshot has no key');
    return {
      questionId: q.questionId.toHexString(),
      optionCount: q.optionCount,
      correctAnswer: q.correctAnswer,
    };
  });
  const issues = validateAnswers(served, body.answers);
  if (issues.length > 0) {
    // Path and reason only, never the submitted values. The session stays open.
    throw validation(
      issues.map((i) => ({
        location: 'body' as const,
        path: `answers.${String(i.index)}.${i.field}`,
        message: ISSUE_MESSAGES[i.reason],
      })),
    );
  }

  const graded = gradeAttempt(served, body.answers, session.passingScore);
  const done = await finalizeSession(
    deps,
    session,
    { endReason: 'submitted', graded, guardExpiry: true },
    info,
  );
  if (!done) {
    deps.logger.warn(
      { requestId: info.requestId, sessionId: body.sessionId },
      'Lost the session claim',
    );
    throw sessionClosed();
  }
  return buildResult(userId, done);
}

export async function abandonSession(
  deps: LearningDeps,
  userId: string,
  target: AssessmentTarget,
  sessionId: string,
  info: RequestInfo,
): Promise<AttemptResultDTO> {
  const resolved = await resolveTarget(userId, target);
  const session = await loadOwnSession(userId, resolved.assessment.id, sessionId);
  if (session.status !== 'open') throw sessionClosed();

  const expired = deps.clock().getTime() >= session.expiresAt.getTime();
  const done = await finalizeSession(
    deps,
    session,
    { endReason: expired ? 'expired' : 'abandoned', graded: null, guardExpiry: false },
    info,
  );
  if (!done) throw sessionClosed();
  return buildResult(userId, done);
}
