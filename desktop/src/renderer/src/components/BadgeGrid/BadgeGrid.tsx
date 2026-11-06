import { useRef, useState, type KeyboardEvent } from 'react';
import { Award } from '../../icons';
import { cx } from '../../lib/cx';
import { AchievementBadge, type AchievementBadgeData } from '../AchievementBadge';
import type { ViewState } from '../Card';
import { EmptyState } from '../EmptyState';
import { ErrorState } from '../ErrorState';
import styles from './BadgeGrid.module.css';

export interface BadgeGridProps {
  badges: readonly AchievementBadgeData[];
  /** Accessible name, e.g. "Your badges". */
  label: string;
  onOpenBadge?: ((id: string) => void) | undefined;
  state?: ViewState | undefined;
  onRetry?: (() => void) | undefined;
  /** Placeholder count while loading. */
  loadingCount?: number | undefined;
  className?: string | undefined;
}

/**
 * Badge collection. With `onOpenBadge`, it is a single Tab stop with Arrow/Home/End roving focus.
 */
export function BadgeGrid({
  badges,
  label,
  onOpenBadge,
  state = 'ready',
  onRetry,
  loadingCount = 7,
  className,
}: BadgeGridProps) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  if (state === 'error') {
    return <ErrorState description="Badges could not be loaded." onRetry={onRetry} compact />;
  }
  if (state === 'empty' || (state === 'ready' && badges.length === 0)) {
    return (
      <EmptyState
        icon={Award}
        title="No badges yet"
        description="Complete a module to earn its badge."
        compact
      />
    );
  }

  const move = (next: number) => {
    const i = (next + badges.length) % badges.length;
    setActive(i);
    refs.current[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (!onOpenBadge) return;
    const map: Record<string, number> = {
      ArrowRight: active + 1,
      ArrowDown: active + 1,
      ArrowLeft: active - 1,
      ArrowUp: active - 1,
      Home: 0,
      End: badges.length - 1,
    };
    const next = map[e.key];
    if (next !== undefined) {
      e.preventDefault();
      move(next);
    }
  };

  if (state === 'loading') {
    return (
      <ul aria-label={label} aria-busy="true" className={cx(styles.grid, className)}>
        {Array.from({ length: loadingCount }, (_, i) => (
          <li key={i}>
            <AchievementBadge
              loading
              badge={{ id: String(i), name: '', motif: '', moduleTitle: '', earned: false }}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    // Roving-focus keyboard handling for the badge buttons inside the list.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <ul aria-label={label} className={cx(styles.grid, className)} onKeyDown={onKeyDown}>
      {badges.map((badge, i) => (
        <li key={badge.id}>
          <AchievementBadge
            badge={badge}
            onOpen={onOpenBadge}
            ref={(el: HTMLButtonElement | null) => {
              refs.current[i] = el;
            }}
            tabIndex={onOpenBadge ? (i === active ? 0 : -1) : undefined}
            onFocus={() => {
              setActive(i);
            }}
          />
        </li>
      ))}
    </ul>
  );
}
