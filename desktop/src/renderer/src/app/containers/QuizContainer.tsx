import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AssessmentSessionDTO } from '../../../../shared/dto';
import type { SecureSessionView } from '../../../../shared/ipcChannels';
import { Alert } from '../../components/Alert';
import type { LockdownState } from '../../components/LockdownBanner';
import {
  QuizScreen,
  type QuizPhase,
  type QuizQuestionData,
  type QuizResultData,
} from '../../screens/Quiz';
import { useAppState, useAppStore, useBridge } from '../AppProvider';
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

export type QuizTarget =
  | {
      kind: 'quiz';
      moduleId: string;
      title: string;
      questionCount: number;
      passingScore: number;
      attemptNumber: number;
    }
  | {
      kind: 'final';
      title: string;
      questionCount: number;
      passingScore: number;
      attemptNumber: number;
    };

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
  onDone: () => void;
}) {
  const bridge = useBridge();
  const store = useAppStore();
  const { lockdown, violation } = useAppState();

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
        questions={questions}
        answers={answers}
        currentIndex={index}
        passMarkPercent={target.passingScore}
        attemptNumber={target.attemptNumber}
        result={shownResult}
        submitting={submitting}
        continueLabel="Back to training"
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
          setSession(null);
          setResult(undefined);
          setEnded(undefined);
          setError(undefined);
          setPhase('intro');
        }}
        onContinue={onDone}
        onBackToModule={onDone}
      />
    </>
  );
}
