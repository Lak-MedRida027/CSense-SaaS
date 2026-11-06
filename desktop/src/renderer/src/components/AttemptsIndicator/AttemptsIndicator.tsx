import { OctagonAlert, TriangleAlert } from '../../icons';
import { cx } from '../../lib/cx';
import styles from './AttemptsIndicator.module.css';

export interface AttemptsIndicatorProps {
  remaining: number;
  max: number;
  /** Noun used in the sentence, default "attempts". */
  noun?: string | undefined;
  className?: string | undefined;
}

/**
 * "2 of 3 attempts remaining" as text plus pips. The last attempt turns caution, none left turns
 * critical, each with an icon. A polite live region announces changes.
 */
export function AttemptsIndicator({
  remaining,
  max,
  noun = 'attempts',
  className,
}: AttemptsIndicatorProps) {
  const left = Math.max(0, Math.min(remaining, max));
  const tone = left === 0 ? 'critical' : left === 1 ? 'caution' : 'neutral';
  const text =
    left === 0
      ? `No ${noun} remaining`
      : left === 1
        ? `Last attempt: 1 of ${max} remaining`
        : `${left} of ${max} ${noun} remaining`;

  return (
    <div className={cx(styles.root, className)} data-tone={tone}>
      <span className={styles.pips} aria-hidden="true">
        {Array.from({ length: max }, (_, i) => (
          <span key={i} className={cx(styles.pip, i < left && styles.on)} />
        ))}
      </span>
      <span role="status" aria-live="polite" className={styles.text}>
        {tone === 'caution' && <TriangleAlert aria-hidden="true" size={16} />}
        {tone === 'critical' && <OctagonAlert aria-hidden="true" size={16} />}
        {text}
      </span>
    </div>
  );
}
