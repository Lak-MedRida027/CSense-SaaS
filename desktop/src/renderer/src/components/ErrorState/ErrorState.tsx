import type { ReactNode } from 'react';
import { OctagonAlert, RotateCcw } from '../../icons';
import { cx } from '../../lib/cx';
import { Button } from '../Button';
import styles from './ErrorState.module.css';

export interface ErrorStateProps {
  title?: string | undefined;
  description?: ReactNode | undefined;
  /** Seam: engineers wire the retry. Hidden when not provided. */
  onRetry?: (() => void) | undefined;
  retryLabel?: string | undefined;
  compact?: boolean | undefined;
  className?: string | undefined;
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
  retryLabel = 'Try again',
  compact = false,
  className,
}: ErrorStateProps) {
  return (
    <div role="status" className={cx(styles.root, compact && styles.compact, className)}>
      <OctagonAlert aria-hidden="true" size={compact ? 24 : 32} className={styles.icon} />
      <p className={styles.title}>{title}</p>
      {description && <p className={styles.description}>{description}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" iconStart={RotateCcw} onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
