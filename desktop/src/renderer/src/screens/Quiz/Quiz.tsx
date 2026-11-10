import { Spinner } from '../../components/Spinner';
import { LockdownShell } from '../../layouts/LockdownShell';
import { QuizIntro } from './QuizIntro';
import { QuizConfirmSubmit, QuizAnswerReview } from './QuizReview';
import { QuizResult } from './QuizResult';
import { QuizRunner } from './QuizRunner';
import type { QuizScreenProps } from './Quiz.types';
import styles from './Quiz.module.css';

const PENDING_TEXT = {
  entering: 'Preparing secure mode...',
  exiting: 'Leaving secure mode...',
  failed: 'Secure mode is required for this quiz.',
  active: '',
} as const;

/**
 * Module quiz and final assessment. Questions only render inside the LockdownShell once the main
 * process reports lockdown `active`. Grading, attempts and unlocking happen outside the UI.
 */
export function QuizScreen(props: QuizScreenProps) {
  const { phase, lockdownState } = props;

  if (phase === 'intro') return <QuizIntro {...props} />;
  if (phase === 'result') return <QuizResult {...props} />;
  if (phase === 'review') return <QuizAnswerReview {...props} />;

  return (
    <LockdownShell
      lockdownState={lockdownState}
      warning={props.lockdownWarning}
      onConfirmExit={props.onConfirmExit}
      pendingContent={
        <div className={styles.pending}>
          <h1 className={styles.pendingTitle}>{props.title}</h1>
          {lockdownState !== 'failed' && <Spinner size="lg" decorative />}
          <p>{PENDING_TEXT[lockdownState]}</p>
        </div>
      }
    >
      {phase === 'answering' ? <QuizRunner {...props} /> : <QuizConfirmSubmit {...props} />}
    </LockdownShell>
  );
}
