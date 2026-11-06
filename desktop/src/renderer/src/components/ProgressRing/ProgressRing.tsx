import type { Level } from '@csense/shared';
import type { ReactNode } from 'react';
import type { StatusTone } from '../../design/tokens';
import { cx } from '../../lib/cx';
import styles from './ProgressRing.module.css';

export interface ProgressRingProps {
  /** Accessible name, e.g. "Experience progress". */
  label: string;
  value: number;
  max?: number | undefined;
  /** Spoken value, e.g. "1,240 XP, 62% of the way to Guardian". */
  valueText?: string | undefined;
  /** Centre content (visual). */
  children?: ReactNode;
  /** Pixel diameter. */
  size?: number | undefined;
  strokeWidth?: number | undefined;
  /** Colour by level (XP ring) or by tone. Level wins when both are set. */
  level?: Level | undefined;
  tone?: StatusTone | 'neutral' | undefined;
  loading?: boolean | undefined;
  className?: string | undefined;
}

export function ProgressRing({
  label,
  value,
  max = 100,
  valueText,
  children,
  size = 128,
  strokeWidth = 10,
  level,
  tone = 'info',
  loading = false,
  className,
}: ProgressRingProps) {
  const clamped = Math.min(Math.max(value, 0), max);
  const pct = max > 0 ? clamped / max : 0;
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={loading ? undefined : 0}
      aria-valuemax={loading ? undefined : max}
      aria-valuenow={loading ? undefined : clamped}
      aria-valuetext={loading ? 'Loading' : (valueText ?? `${Math.round(pct * 100)}%`)}
      aria-busy={loading || undefined}
      data-level={level}
      data-tone={level ? undefined : tone}
      className={cx(styles.root, level ? styles.byLevel : styles.byTone, className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          className={styles.track}
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {!loading && (
          <circle
            className={styles.fill}
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - pct)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <div className={styles.center} aria-hidden="true">
        {children}
      </div>
    </div>
  );
}
