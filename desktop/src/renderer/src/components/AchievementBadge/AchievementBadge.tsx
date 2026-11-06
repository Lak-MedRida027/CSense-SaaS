import { createElement, type ComponentPropsWithRef } from 'react';
import { Lock } from '../../icons';
import { cx } from '../../lib/cx';
import { Skeleton } from '../Skeleton';
import { badgeIcon } from './badgeMotifs';
import styles from './AchievementBadge.module.css';

export interface AchievementBadgeData {
  id: string;
  name: string;
  /** `BadgeDTO.iconMotif`. */
  motif: string;
  /** Module the badge belongs to (one badge per module). */
  moduleTitle: string;
  earned: boolean;
  /** ISO date string; shown when earned. */
  earnedAt?: string | undefined;
}

export interface AchievementBadgeProps extends Omit<
  ComponentPropsWithRef<'button'>,
  'children' | 'onClick'
> {
  badge: AchievementBadgeData;
  /** Seam: open the badge detail. Without it the badge renders as static content. */
  onOpen?: ((id: string) => void) | undefined;
  /** Play the unlock animation once (static under reduced motion). */
  justUnlocked?: boolean | undefined;
  size?: 'md' | 'lg' | undefined;
  loading?: boolean | undefined;
}

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** Earned vs not earned differs by fill, a lock icon and text, not colour alone. */
export function AchievementBadge({
  badge,
  onOpen,
  justUnlocked = false,
  size = 'md',
  loading = false,
  className,
  ...rest
}: AchievementBadgeProps) {
  if (loading) {
    return (
      <div className={cx(styles.root, styles[size], className)} aria-busy="true">
        <Skeleton shape="circle" width={size === 'lg' ? 72 : 56} height={size === 'lg' ? 72 : 56} />
        <Skeleton shape="text" width="80%" />
        <span className="sr-only">Loading badge</span>
      </div>
    );
  }

  const status = badge.earned
    ? `Earned${badge.earnedAt ? ` ${dateFmt.format(new Date(badge.earnedAt))}` : ''}`
    : 'Not earned yet';

  const content = (
    <>
      <span className={styles.medal} aria-hidden="true">
        {createElement(badgeIcon(badge.motif), { size: size === 'lg' ? 32 : 24 })}
        {!badge.earned && (
          <span className={styles.lock}>
            <Lock size={12} />
          </span>
        )}
      </span>
      <span className={styles.name}>{badge.name}</span>
      <span className={styles.status}>{status}</span>
      <span className="sr-only">, badge for {badge.moduleTitle}</span>
    </>
  );

  const classes = cx(
    styles.root,
    styles[size],
    badge.earned ? styles.earned : styles.locked,
    justUnlocked && badge.earned && styles.unlocked,
    className,
  );

  if (!onOpen) return <div className={classes}>{content}</div>;
  return (
    <button
      {...rest}
      type="button"
      className={cx(classes, styles.interactive)}
      onClick={() => {
        onOpen(badge.id);
      }}
    >
      {content}
    </button>
  );
}
