import { LEVELS, type Level } from '@csense/shared';
import { Check, Lock } from '../../icons';
import { cx } from '../../lib/cx';
import { LevelCrest } from '../LevelChip/LevelCrest';
import styles from './LevelLadder.module.css';

export interface LevelLadderProps {
  currentLevel: Level;
  /** Optional XP floor per level, shown under each tier (thresholds arrive in Phase 4). */
  thresholds?: Partial<Record<Level, number>> | undefined;
  orientation?: 'horizontal' | 'vertical' | undefined;
  className?: string | undefined;
}

const fmt = new Intl.NumberFormat('en');

/** The five-tier ladder. Reached, current and locked tiers differ by icon and text. */
export function LevelLadder({
  currentLevel,
  thresholds,
  orientation = 'horizontal',
  className,
}: LevelLadderProps) {
  const currentIdx = LEVELS.indexOf(currentLevel);
  return (
    <ol aria-label="Level ladder" className={cx(styles.list, styles[orientation], className)}>
      {LEVELS.map((level, i) => {
        const state = i < currentIdx ? 'reached' : i === currentIdx ? 'current' : 'locked';
        const floor = thresholds?.[level];
        return (
          <li
            key={level}
            data-level={level}
            aria-current={state === 'current' ? 'step' : undefined}
            className={cx(styles.item, styles[state])}
          >
            <LevelCrest level={level} size="sm" />
            <span className={styles.name}>
              L{i + 1} {level}
            </span>
            <span className={styles.state}>
              {state === 'reached' && <Check aria-hidden="true" size={14} />}
              {state === 'locked' && <Lock aria-hidden="true" size={14} />}
              {state === 'reached' ? 'Reached' : state === 'current' ? 'Current' : 'Locked'}
            </span>
            {floor !== undefined && <span className={styles.floor}>{fmt.format(floor)} XP</span>}
          </li>
        );
      })}
    </ol>
  );
}
