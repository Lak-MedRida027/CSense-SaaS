import type { Level } from '@csense/shared';
import { useId } from 'react';
import { cx } from '../../lib/cx';
import styles from './XPBar.module.css';

export interface XPBarProps {
  /** Employee's total XP. */
  totalXP: number;
  /** XP at which the current level starts (from the shared level thresholds, Phase 4). */
  currentLevelFloorXP: number;
  /** XP needed for the next level; `undefined` at the top level. */
  nextLevelXP: number | undefined;
  currentLevel: Level;
  nextLevel: Level | undefined;
  loading?: boolean | undefined;
  className?: string | undefined;
}

const fmt = new Intl.NumberFormat('en');

/** Progress to the next level. All thresholds are props; nothing is computed from rules here. */
export function XPBar({
  totalXP,
  currentLevelFloorXP,
  nextLevelXP,
  currentLevel,
  nextLevel,
  loading = false,
  className,
}: XPBarProps) {
  const id = useId();
  const atMax = nextLevelXP === undefined || nextLevel === undefined;
  const span = atMax ? 1 : Math.max(nextLevelXP - currentLevelFloorXP, 1);
  const into = atMax ? 1 : Math.min(Math.max(totalXP - currentLevelFloorXP, 0), span);
  const pct = Math.round((into / span) * 100);
  const remaining = atMax ? 0 : Math.max(nextLevelXP - totalXP, 0);
  const caption = atMax ? 'Top level reached' : `${fmt.format(remaining)} XP to ${nextLevel}`;

  return (
    <div className={cx(styles.root, className)} data-level={currentLevel}>
      <div className={styles.header}>
        <span id={id} className={styles.xp}>
          {loading ? 'Loading XP' : `${fmt.format(totalXP)} XP`}
        </span>
        {!loading && <span className={styles.caption}>{caption}</span>}
      </div>
      <div
        role="progressbar"
        aria-labelledby={id}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={loading ? undefined : pct}
        aria-valuetext={loading ? 'Loading' : `${fmt.format(totalXP)} XP, ${caption}`}
        aria-busy={loading || undefined}
        className={styles.track}
      >
        {!loading && <div className={styles.fill} style={{ width: `${pct}%` }} />}
      </div>
    </div>
  );
}
