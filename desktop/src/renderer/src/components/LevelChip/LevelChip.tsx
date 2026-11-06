import type { Level } from '@csense/shared';
import { levelMeta } from '../../design/tokens/levels';
import { cx } from '../../lib/cx';
import { LevelCrest } from './LevelCrest';
import styles from './LevelChip.module.css';

export interface LevelChipProps {
  level: Level;
  size?: 'sm' | 'md' | 'lg' | undefined;
  /** Show only "L3" (the full name is kept for screen readers). */
  compact?: boolean | undefined;
  className?: string | undefined;
}

/** "L3 Practitioner" with crest. Colour reinforces, never replaces, the numeral and name. */
export function LevelChip({ level, size = 'md', compact = false, className }: LevelChipProps) {
  const { tier } = levelMeta[level];
  return (
    <span data-level={level} className={cx(styles.chip, styles[size], className)}>
      <LevelCrest level={level} size={size} />
      <span className={styles.tier}>L{tier}</span>
      {compact ? (
        <span className="sr-only">{level}</span>
      ) : (
        <span className={styles.name}>{level}</span>
      )}
      <span className="sr-only"> level</span>
    </span>
  );
}
