import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssessmentSessionDTO, AttemptResultDTO } from '../../../../shared/dto';
import type { SecureSessionView } from '../../../../shared/ipcChannels';
import { Alert } from '../../components/Alert';
import type { LockdownState } from '../../components/LockdownBanner';
import {
  QuizScreen,
  type QuizPhase,
  type QuizQuestionData,
  type QuizResultData,
} from '../../screens/Quiz';
import { useAppState, useAppStore, useBridge, useLearningStore } from '../AppProvider';
import { detectAchievements } from '../learning/achievements';
import { toQuizReview, type QuizReviewData } from '../learning/mappers';
import type { QuizTarget } from '../learning/quizTarget';
import { useWorkspace } from '../WorkspaceContext';
import {
  RESTARTED_MESSAGE,
  abandonedResult,
  endedMessage,
  quizStartErrorMessage,
  submitErrorMessage,
  toQuizResult,
  violationMessage,
} from '../messages';
import styles from './QuizContainer.module.css';

export type { QuizTarget };

/** What the secure session reports about itself (used when resuming after a renderer reload). */
export function targetFromSession(s: AssessmentSessionDTO): QuizTarget {
  return s.kind === 'FinalTest' || s.moduleId === null
    ? {
        kind: 'final',
        title: s.title,
        questionCount: s.questions.length,
        passingScore: s.passingScore,
        attemptNumber: s.attemptNumber,
      }
    : {
        kind: 'quiz',
        moduleId: s.moduleId,
        title: s.title,
        questionCount: s.questions.length,
        passingScore: s.passingScore,
        attemptNumber: s.attemptNumber,
      };
}

const VIOLATION_VISIBLE_MS = 10_000;

/** Placeholder questions for the intro screen, which only reads `length`. No content is shown. */
const introPlaceholders = (n: number): QuizQuestionData[] =>
  Array.from({ length: n }, (_, i) => ({ id: `placeholder-${String(i)}`, stem: '', options: [] }));

function mapQuestions(s: AssessmentSessionDTO): QuizQuestionData[] {
  return s.questions.map((q) => ({
    id: q.questionId,
    stem: q.text,
    options: q.options.map((text, i) => ({ id: String(i), text })),
  }));
}

/**
 * Quiz flow over the bridge. Questions exist in this component only after main reports a running,
 * locked-down session (`assessment.startSecure`); every exit path ends in a result or back at home.
 */
export function QuizContainer({
  target,
  resume,
  onDone,
}: {
  target: QuizTarget;
  /** Set when main still holds a session after a renderer crash/reload. */
  resume?: SecureSessionView | null | undefined;
  onDone: (passed: boolean) => void;
}) {
  const bridge = useBridge();
  const store = useAppStore();
  const learning = useLearningStore();
  const ws = useWorkspace();
  const { lockdown, violation } = useAppState();
  const [attemptResult, setAttemptResult] = useState<AttemptResultDTO | null>(null);
  const [review, setReview] = useState<QuizReviewData | null>(null);
  // XP before the attempt, for level-up detection (null when the dashboard never loaded).
  const xpBefore = useRef(learning.getState().xp.data);
  const achievementsDone = useRef<Promise<void> | null>(null);
  // The intro is outside lockdown: make sure the pre-attempt XP is known (first launch via onboarding
  // never loaded it), because content reads are closed once the quiz starts.
  useEffect(() => {
    if (xpBefore.current) return;
    void learning.refresh(['xp']).then(() => {
      xpBefore.current ??= learning.getState().xp.data;
    });
  }, [learning]);

  const [phase, setPhase] = useState<QuizPhase>(resume ? 'answering' : 'intro');
  const [starting, setStarting] = useState(false);
  const [session, setSession] = useState<AssessmentSessionDTO | null>(resume?.session ?? null);
  const [answers, setAnswers] = useState<Record<string, string | null>>({});
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<QuizResultData | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [ended, setEnded] = useState<string | undefined>();
  const [restartedNotice, setRestartedNotice] = useState<string | undefined>(
    resume?.resumed ? RESTARTED_MESSAGE : undefined,
  );

  // The resumed session has been taken over; main's cached copy stays authoritative.
  useEffect(() => {
    if (resume) store.clearResume();
  }, [resume, store]);

  // Focus-loss / devtools warnings fade after a while; the banner message is not a permanent state.
  useEffect(() => {
    if (!violation) return undefined;
    const t = window.setTimeout(() => {
      store.clearViolation();
    }, VIOLATION_VISIBLE_MS);
    return () => {
      window.clearTimeout(t);
    };
  }, [violation, store]);

  // Main ended the attempt (focus policy, crash, hard cap): derived, so no effect-driven state.
  const reason = lockdown.endReason;
  const mainEnded =
    !starting &&
    lockdown.state === 'inactive' &&
    session !== null &&
    lockdown.sessionId === session.sessionId &&
    (phase === 'answering' || phase === 'confirm-submit') &&
    (reason === 'focus_lost' ||
      reason === 'crash' ||
      reason === 'hard_cap' ||
      reason === 'session_expired');

  // Module content and `me.*` are closed while locked down (ADR 0020), so the post-attempt refresh
  // waits for lockdown to end. Passing queues one achievement dialog for the dashboard (plan 7.5).
  useEffect(() => {
    if (!attemptResult || lockdown.state !== 'inactive' || achievementsDone.current) return;
    const result = attemptResult;
    achievementsDone.current = (async () => {
      await learning.refresh(['overview', 'xp', 'badges']);
      if (result.passed) {
        ws.queueAchievements(
          detectAchievements(xpBefore.current, learning.getState().xp.data, result),
        );
      }
    })();
  }, [attemptResult, lockdown.state, learning, ws]);

  const finish = useCallback(async () => {
    await achievementsDone.current?.catch(() => undefined);
    onDone(attemptResult?.passed === true);
  }, [attemptResult, onDone]);

  const questions = useMemo(
    () => (session ? mapQuestions(session) : introPlaceholders(target.questionCount)),
    [session, target.questionCount],
  );

  const start = useCallback(async () => {
    setError(undefined);
    setEnded(undefined);
    setStarting(true);
    try {
      const res = await bridge.assessment.startSecure(
        target.kind === 'quiz' ? { kind: 'quiz', moduleId: target.moduleId } : { kind: 'final' },
      );
      if (!res.ok) {
        setError(quizStartErrorMessage(res.error));
        return;
      }
      setSession(res.data.session);
      setAnswers({});
      setIndex(0);
      setResult(undefined);
      setRestartedNotice(undefined);
      setPhase('answering');
    } catch {
      setError(quizStartErrorMessage({ code: 'NETWORK_UNAVAILABLE', message: '' }));
    } finally {
      setStarting(false);
    }
  }, [bridge, target]);

  const submit = useCallback(async () => {
    if (!session) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const res = await bridge.assessment.submit({
        sessionId: session.sessionId,
        answers: session.questions.map((q) => {
          const picked = answers[q.questionId];
          return {
            questionId: q.questionId,
            selectedIndex: picked === null || picked === undefined ? null : Number(picked),
          };
        }),
      });
      if (res.ok) {
        setAttemptResult(res.data);
        setResult(toQuizResult(res.data, target.title));
        setPhase('result');
      } else if (
        res.error.code === 'SESSION_EXPIRED' ||
        res.error.code === 'SESSION_CLOSED' ||
        res.error.code === 'NOT_SIGNED_IN'
      ) {
        setEnded(submitErrorMessage(res.error));
        setResult(abandonedResult(session.questions.length));
        setPhase('result');
      } else {
        setError(submitErrorMessage(res.error));
      }
    } catch {
      setError(submitErrorMessage({ code: 'NETWORK_UNAVAILABLE', message: '' }));
    } finally {
      setSubmitting(false);
    }
  }, [bridge, session, answers, target.title]);

  const exit = useCallback(async () => {
    if (!session) return;
    try {
      const res = await bridge.assessment.exit({ sessionId: session.sessionId });
      if (res.ok && res.data.attempt) {
        setAttemptResult(res.data.attempt);
        setResult(toQuizResult(res.data.attempt, target.title));
      } else {
        setResult(abandonedResult(session.questions.length));
      }
    } catch {
      setResult(abandonedResult(session.questions.length));
    }
    setEnded('You left the quiz. This counted as an attempt.');
    setPhase('result');
  }, [bridge, session, target.title]);

  const lockdownState: LockdownState =
    starting && lockdown.state === 'inactive'
      ? 'entering'
      : lockdown.state === 'inactive'
        ? 'exiting'
        : lockdown.state;

  const shownPhase: QuizPhase = starting ? 'answering' : mainEnded ? 'result' : phase;
  const canReview = (attemptResult?.review.length ?? 0) > 0 && !mainEnded;
  const shownResult = mainEnded ? abandonedResult(session.questions.length) : result;
  const notice = error ?? (mainEnded ? endedMessage(reason) : ended);

  return (
    <>
      {notice && (
        <div className={styles.notice}>
          <Alert tone={error ? 'critical' : 'caution'} title={notice} />
        </div>
      )}
      <QuizScreen
        kind={target.kind === 'final' ? 'final' : 'module'}
        title={target.title}
        phase={shownPhase}
        lockdownState={lockdownState}
        lockdownWarning={violationMessage(violation) ?? restartedNotice}
        questions={phase === 'review' && review ? review.questions : questions}
        answers={phase === 'review' && review ? review.answers : answers}
        startBlocked={target.startBlocked}
        currentIndex={index}
        passMarkPercent={target.passingScore}
        attemptNumber={target.attemptNumber}
        result={shownResult}
        submitting={submitting}
        continueLabel="Continue"
        backLabel={target.kind === 'final' ? 'Back to final assessment' : 'Back to module'}
        onReviewAnswers={
          canReview && attemptResult
            ? () => {
                setReview(toQuizReview(attemptResult));
                setPhase('review');
              }
            : undefined
        }
        onRequestStartLockdown={() => {
          void start();
        }}
        onAnswer={(questionId, optionId) => {
          setAnswers((a) => ({ ...a, [questionId]: optionId }));
        }}
        onNavigate={setIndex}
        onRequestSubmitReview={() => {
          setPhase('confirm-submit');
        }}
        onBackToQuestions={() => {
          setPhase('answering');
        }}
        onSubmit={() => {
          void submit();
        }}
        onConfirmExit={() => {
          void exit();
        }}
        onBackToResult={() => {
          setPhase('result');
        }}
        onRetry={() => {
          achievementsDone.current = null;
          xpBefore.current = learning.getState().xp.data;
          setAttemptResult(null);
          setReview(null);
          setSession(null);
          setResult(undefined);
          setEnded(undefined);
          setError(undefined);
          setPhase('intro');
        }}
        onContinue={() => {
          void finish();
        }}
        onBackToModule={() => {
          onDone(false);
        }}
      />
    </>
  );
}
