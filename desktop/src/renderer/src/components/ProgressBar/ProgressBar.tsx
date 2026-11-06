import { useId, type ReactNode } from 'react';
import type { StatusTone } from '../../design/tokens';
import { cx } from '../../lib/cx';
import styles from './ProgressBar.module.css';

export interface ProgressBarProps {
  /** Visible label (also the accessible name). */
  label: ReactNode;
  value: number;
  max?: number | undefined;
  /** Human-readable value, e.g. "3 of 7 modules". Defaults to a percentage. */
  valueText?: string | undefined;
  showValue?: boolean | undefined;
  hideLabel?: boolean | undefined;
  /** `neutral` uses the brand primary; status tones for contextual meaning. */
  tone?: StatusTone | 'neutral' | undefined;
  size?: 'sm' | 'md' | undefined;
  /** Unknown progress (loading). */
  indeterminate?: boolean | undefined;
  className?: string | undefined;
}

export function ProgressBar({
  label,
  value,
  max = 100,
  valueText,
  showValue = true,
  hideLabel = false,
  tone = 'info',
  size = 'md',
  indeterminate = false,
  className,
}: ProgressBarProps) {
  const id = useId();
  const clamped = Math.min(Math.max(value, 0), max);
  const pct = max > 0 ? Math.round((clamped / max) * 100) : 0;
  const text = valueText ?? `${pct}%`;

  return (
    <div className={cx(styles.root, className)} data-tone={tone}>
      <div className={cx(styles.header, hideLabel && !showValue && 'sr-only')}>
        <span id={id} className={cx(styles.label, hideLabel && 'sr-only')}>
          {label}
        </span>
        {showValue && !indeterminate && (
          <span className={styles.value} aria-hidden="true">
            {text}
          </span>
        )}
      </div>
      <div
        role="progressbar"
        aria-labelledby={id}
        aria-valuemin={indeterminate ? undefined : 0}
        aria-valuemax={indeterminate ? undefined : max}
        aria-valuenow={indeterminate ? undefined : clamped}
        aria-valuetext={indeterminate ? 'Loading' : text}
        aria-busy={indeterminate || undefined}
        className={cx(styles.track, styles[size])}
      >
        <div
          className={cx(styles.fill, indeterminate && styles.indeterminate)}
          style={indeterminate ? undefined : { width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
