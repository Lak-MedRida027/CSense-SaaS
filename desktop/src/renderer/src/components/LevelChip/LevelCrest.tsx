import type { Level } from '@csense/shared';
import { levelMeta } from '../../design/tokens/levels';
import { Star } from '../../icons';
import { cx } from '../../lib/cx';
import styles from './LevelChip.module.css';

export interface LevelCrestProps {
  level: Level;
  size?: 'sm' | 'md' | 'lg' | undefined;
  className?: string | undefined;
}

/**
 * Decorative crest: one pip per tier and a star for Defender, so tiers differ by shape and count
 * as well as colour. Always pair with the level name (LevelChip does).
 */
export function LevelCrest({ level, size = 'md', className }: LevelCrestProps) {
  const meta = levelMeta[level];
  return (
    <span
      aria-hidden="true"
      data-level={level}
      className={cx(styles.crest, styles[`crest-${size}`], className)}
    >
      <span className={styles.pips}>
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className={cx(styles.pip, i < meta.pips && styles.pipOn)} />
        ))}
      </span>
      {meta.star && (
        <Star size={size === 'lg' ? 16 : 12} className={styles.star} fill="currentColor" />
      )}
    </span>
  );
}
