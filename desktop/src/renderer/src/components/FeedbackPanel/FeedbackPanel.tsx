import { useEffect, useRef, type ReactNode } from 'react';
import { CircleCheck, CircleX } from '../../icons';
import { cx } from '../../lib/cx';
import styles from './FeedbackPanel.module.css';

export interface FeedbackPanelProps {
  correct: boolean;
  explanation: ReactNode;
  /** Defaults to "Correct" / "Incorrect". */
  title?: string | undefined;
  /** Move focus to the heading on mount so screen readers read the feedback (default true). */
  focusOnMount?: boolean | undefined;
  children?: ReactNode;
  className?: string | undefined;
}

/** Immediate right/wrong feedback with a short explanation: icon + word + colour. */
export function FeedbackPanel({
  correct,
  explanation,
  title,
  focusOnMount = true,
  children,
  className,
}: FeedbackPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnMount) headingRef.current?.focus();
  }, [focusOnMount]);
  const Icon = correct ? CircleCheck : CircleX;
  return (
    <div className={cx(styles.root, className)} data-tone={correct ? 'success' : 'critical'}>
      <h3 ref={headingRef} tabIndex={-1} className={styles.title}>
        <Icon aria-hidden="true" size={20} />
        {title ?? (correct ? 'Correct' : 'Incorrect')}
      </h3>
      <div className={styles.explanation}>{explanation}</div>
      {children}
    </div>
  );
}
