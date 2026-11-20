import { LEVELS, type Level } from '@csense/shared';
import { useRef } from 'react';
import { useTheme } from '../../design/theme/useTheme';
import { ArrowRight, Trophy } from '../../icons';
import { AchievementBadge, type AchievementBadgeData } from '../AchievementBadge';
import { Button } from '../Button';
import { Dialog } from '../Dialog';
import { LevelChip } from '../LevelChip';
import styles from './AchievementDialog.module.css';

export interface AchievementDialogProps {
  open: boolean;
  /** A newly earned badge. */
  badge?: AchievementBadgeData | undefined;
  /** The employee moved up a level. */
  levelUp?: { from: string; to: string } | undefined;
  /** The final assessment was passed. */
  trainingComplete?: boolean | undefined;
  onClose: () => void;
}

const isLevel = (v: string): v is Level => LEVELS.some((l) => l === v);

/** The dialog title doubles as the screen reader announcement. */
export function achievementTitle(
  p: Pick<AchievementDialogProps, 'badge' | 'levelUp' | 'trainingComplete'>,
): string {
  if (p.trainingComplete) return "You've completed your training";
  if (p.badge && p.levelUp) return `Badge earned and level up: ${p.levelUp.to}`;
  if (p.badge) return `Badge earned: ${p.badge.name}`;
  if (p.levelUp) return `Level up: ${p.levelUp.to}`;
  return 'Well done';
}

/**
 * One celebratory moment after returning to the dashboard (plan 7.5): badge, level-up and training
 * complete combined in a single dialog. Motion only when reduced motion is off.
 */
export function AchievementDialog({
  open,
  badge,
  levelUp,
  trainingComplete = false,
  onClose,
}: AchievementDialogProps) {
  const { reducedMotion } = useTheme();
  const closeRef = useRef<HTMLButtonElement>(null);
  const to = levelUp && isLevel(levelUp.to) ? levelUp.to : null;
  const from = levelUp && isLevel(levelUp.from) ? levelUp.from : null;
  return (
    <Dialog
      open={open}
      title={achievementTitle({ badge, levelUp, trainingComplete })}
      onClose={onClose}
      size="sm"
      initialFocusRef={closeRef}
      footer={
        <Button ref={closeRef} iconEnd={ArrowRight} onClick={onClose}>
          Continue
        </Button>
      }
    >
      <div className={styles.body} data-motion={reducedMotion ? 'reduced' : 'full'}>
        {trainingComplete && (
          <p className={styles.lead}>
            <Trophy aria-hidden="true" size={20} />
            You have passed every module and the final assessment. Thank you for keeping the
            organisation safe.
          </p>
        )}
        {badge && (
          <div className={styles.badge}>
            <AchievementBadge badge={badge} size="lg" justUnlocked={!reducedMotion} />
          </div>
        )}
        {to && (
          <div className={styles.level}>
            {from && (
              <>
                <LevelChip level={from} size="sm" />
                <ArrowRight aria-hidden="true" size={16} />
              </>
            )}
            <LevelChip level={to} size="lg" />
          </div>
        )}
      </div>
    </Dialog>
  );
}
