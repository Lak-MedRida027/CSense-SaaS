import type { ReactNode } from 'react';
import type { StatusTone } from '../../design/tokens';
import { ArrowDown, ArrowRight, ArrowUp, Minus, type LucideIcon } from '../../icons';
import { cx } from '../../lib/cx';
import cardStyles from '../Card/Card.module.css';
import { Skeleton } from '../Skeleton';
import styles from './StatTile.module.css';

export interface StatDelta {
  /** Display text, e.g. "+4% vs last month". */
  text: string;
  direction: 'up' | 'down' | 'flat';
  /** Whether this change is good news; drives tone. Direction alone never implies good/bad. */
  sentiment: 'positive' | 'negative' | 'neutral';
}

export interface StatTileProps {
  label: string;
  value: ReactNode;
  unit?: string | undefined;
  delta?: StatDelta | undefined;
  icon?: LucideIcon | undefined;
  /** Tints the icon (e.g. critical for "High-risk employees"). Always paired with the label. */
  tone?: StatusTone | 'neutral' | undefined;
  /** Seam: drill into a filtered view. Makes the whole tile clickable (stretched button). */
  onActivate?: (() => void) | undefined;
  state?: 'ready' | 'loading' | 'empty' | 'error' | undefined;
  className?: string | undefined;
}

const DELTA_ICON = { up: ArrowUp, down: ArrowDown, flat: Minus } as const;
const SENTIMENT_TONE = { positive: 'success', negative: 'critical', neutral: 'neutral' } as const;

export function StatTile({
  label,
  value,
  unit,
  delta,
  icon: Icon,
  tone = 'neutral',
  onActivate,
  state = 'ready',
  className,
}: StatTileProps) {
  const DeltaIcon = delta ? DELTA_ICON[delta.direction] : null;
  let body: ReactNode;
  if (state === 'loading') {
    body = (
      <>
        <Skeleton shape="text" width="50%" height="2rem" />
        <span className="sr-only">Loading</span>
      </>
    );
  } else if (state === 'empty') {
    body = <p className={styles.muted}>No data yet</p>;
  } else if (state === 'error') {
    body = <p className={styles.muted}>Unavailable</p>;
  } else {
    body = (
      <>
        <p className={styles.value}>
          {value}
          {unit && <span className={styles.unit}>{unit}</span>}
        </p>
        {delta && DeltaIcon && (
          <p className={styles.delta} data-tone={SENTIMENT_TONE[delta.sentiment]}>
            <DeltaIcon aria-hidden="true" size={14} />
            {delta.text}
          </p>
        )}
      </>
    );
  }

  return (
    <div
      className={cx(styles.root, cardStyles.root, onActivate && cardStyles.interactive, className)}
      aria-busy={state === 'loading' || undefined}
    >
      <div className={styles.top}>
        {onActivate ? (
          <button
            type="button"
            className={cx(styles.label, styles.button, cardStyles.stretch)}
            onClick={onActivate}
          >
            {label}
          </button>
        ) : (
          <p className={styles.label}>{label}</p>
        )}
        {Icon && (
          <span className={styles.icon} data-tone={tone} aria-hidden="true">
            <Icon size={18} />
          </span>
        )}
      </div>
      {body}
      {onActivate && <ArrowRight aria-hidden="true" size={16} className={styles.chevron} />}
    </div>
  );
}
