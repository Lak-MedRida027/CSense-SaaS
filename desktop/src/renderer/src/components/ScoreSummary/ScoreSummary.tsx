import { useEffect, useId, useRef } from 'react';
import { ArrowRight, CircleCheck, ListChecks, RotateCcw, TriangleAlert, Zap } from '../../icons';
import { cx } from '../../lib/cx';
import { AchievementBadge, type AchievementBadgeData } from '../AchievementBadge';
import { Button } from '../Button';
import styles from './ScoreSummary.module.css';

export interface ScoreSummaryProps {
  /** e.g. "Module 3 quiz" or "Final assessment". */
  title: string;
  scorePercent: number;
  /** Configurable per module (default 70). Passed in; never hardcoded here. */
  passMarkPercent: number;
  /** Pass/fail decided by the engine, not recomputed by the UI. */
  passed: boolean;
  correctCount: number;
  totalCount: number;
  xpEarned?: number | undefined;
  /** Badge unlocked by this pass (one per module). */
  badge?: AchievementBadgeData | undefined;
  onReview?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onContinue?: (() => void) | undefined;
  continueLabel?: string | undefined;
  loading?: boolean | undefined;
  className?: string | undefined;
}

/** Result screen block. Pass/fail is icon + word + colour; focus lands on the heading. */
export function ScoreSummary({
  title,
  scorePercent,
  passMarkPercent,
  passed,
  correctCount,
  totalCount,
  xpEarned,
  badge,
  onReview,
  onRetry,
  onContinue,
  continueLabel = 'Continue',
  loading = false,
  className,
}: ScoreSummaryProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  useEffect(() => {
    if (!loading) headingRef.current?.focus();
  }, [loading]);

  if (loading) {
    return (
      <div className={cx(styles.root, className)} aria-busy="true">
        <p className={styles.loading}>Calculating your score...</p>
      </div>
    );
  }

  const Icon = passed ? CircleCheck : TriangleAlert;
  return (
    <section
      className={cx(styles.root, className)}
      data-tone={passed ? 'success' : 'caution'}
      aria-labelledby={headingId}
    >
      <p className={styles.eyebrow}>{title}</p>
      <h1 id={headingId} ref={headingRef} tabIndex={-1} className={styles.heading}>
        <span className={styles.score}>{scorePercent}%</span>
        <span className={styles.verdict}>
          <Icon aria-hidden="true" size={28} />
          {passed ? 'Passed' : 'Not passed'}
        </span>
      </h1>
      <p className={styles.detail}>
        {correctCount} of {totalCount} correct · pass mark {passMarkPercent}%
        {!passed && ` · you need ${passMarkPercent}% to unlock the next module`}
      </p>
      {passed && (xpEarned !== undefined || badge) && (
        <div className={styles.rewards}>
          {xpEarned !== undefined && (
            <p className={styles.xp}>
              <Zap aria-hidden="true" size={18} />+{xpEarned} XP
            </p>
          )}
          {badge && <AchievementBadge badge={badge} justUnlocked size="lg" />}
        </div>
      )}
      <div className={styles.actions}>
        {onReview && (
          <Button variant="secondary" iconStart={ListChecks} onClick={onReview}>
            Review answers
          </Button>
        )}
        {!passed && onRetry && (
          <Button iconStart={RotateCcw} onClick={onRetry}>
            Retry quiz
          </Button>
        )}
        {passed && onContinue && (
          <Button iconEnd={ArrowRight} onClick={onContinue}>
            {continueLabel}
          </Button>
        )}
      </div>
    </section>
  );
}
