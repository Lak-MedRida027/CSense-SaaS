import { Lock, OctagonAlert } from '../../icons';
import { cx } from '../../lib/cx';
import { Button } from '../Button';
import { Spinner } from '../Spinner';
import styles from './LockdownBanner.module.css';

/** Mirrors the lockdown lifecycle the main process will report (Phase 5). */
export type LockdownState = 'entering' | 'active' | 'exiting' | 'failed';

export interface LockdownBannerProps {
  state: LockdownState;
  /** Seam: user asked to leave the quiz. The shell shows a confirmation before calling exit. */
  onRequestExit: () => void;
  /** Shown while active; defaults to the plain-language restriction notice. */
  message?: string | undefined;
  className?: string | undefined;
}

const COPY: Record<LockdownState, { title: string; body: string }> = {
  entering: { title: 'Entering secure quiz mode', body: 'Restricting shortcuts and other apps...' },
  active: {
    title: 'Secure quiz mode is on',
    body: 'Shortcuts, clipboard and other apps are restricted until you submit.',
  },
  exiting: { title: 'Leaving secure quiz mode', body: 'Restoring normal access...' },
  failed: {
    title: 'Secure mode could not start',
    body: 'The quiz cannot begin. Contact your security team.',
  },
};

/**
 * Persistent, non-dismissible banner shown for the whole time lockdown is active. Esc is blocked
 * during lockdown, so "Exit quiz" is the always-visible, keyboard-reachable way out (WCAG 2.1.2).
 */
export function LockdownBanner({ state, onRequestExit, message, className }: LockdownBannerProps) {
  const copy = COPY[state];
  const busy = state === 'entering' || state === 'exiting';
  return (
    <section
      aria-label="Secure quiz mode"
      className={cx(styles.root, className)}
      data-tone={state === 'failed' ? 'critical' : 'info'}
    >
      <span className={styles.icon} aria-hidden="true">
        {state === 'failed' ? <OctagonAlert size={20} /> : <Lock size={20} />}
      </span>
      <div className={styles.text} role="status" aria-live="polite">
        <p className={styles.title}>{copy.title}</p>
        <p className={styles.body}>{state === 'active' && message ? message : copy.body}</p>
      </div>
      {busy && <Spinner size="sm" decorative />}
      {state === 'active' && (
        <Button variant="secondary" size="sm" onClick={onRequestExit} className={styles.exit}>
          Exit quiz
        </Button>
      )}
    </section>
  );
}
