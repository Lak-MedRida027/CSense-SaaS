import type { RiskDimension, RiskLevel } from '@csense/shared';
import { useId, useState } from 'react';
import { ChevronDown, ChevronRight } from '../../icons';
import { cx } from '../../lib/cx';
import { Avatar } from '../Avatar';
import { EmptyState } from '../EmptyState';
import { ErrorState } from '../ErrorState';
import { RiskBreakdown } from '../RiskBreakdown';
import { RiskChip } from '../RiskChip';
import { SkeletonText } from '../Skeleton';
import styles from './Scoreboard.module.css';

export interface ScoreboardEntry {
  id: string;
  /** Rank as computed by the engine (1 = highest risk). */
  rank: number;
  name: string;
  department?: string | undefined;
  compositeScore: number;
  riskLevel: RiskLevel;
  scores: Readonly<Record<RiskDimension, number>>;
}

export interface ScoreboardProps {
  title: string;
  entries: readonly ScoreboardEntry[];
  /** Seam: open the employee's profile. */
  onOpenEntry?: ((id: string) => void) | undefined;
  state?: 'ready' | 'loading' | 'empty' | 'error' | undefined;
  onRetry?: (() => void) | undefined;
  headingLevel?: 2 | 3 | undefined;
  className?: string | undefined;
}

/** Ordered risk scoreboard; each row expands (disclosure) into the four-dimension breakdown. */
export function Scoreboard({
  title,
  entries,
  onOpenEntry,
  state = 'ready',
  onRetry,
  headingLevel = 2,
  className,
}: ScoreboardProps) {
  const [open, setOpen] = useState<string | null>(null);
  const baseId = useId();
  const Heading = `h${headingLevel}` as const;

  let body;
  if (state === 'loading') {
    body = (
      <div aria-busy="true">
        <SkeletonText lines={5} />
        <span className="sr-only">Loading scoreboard</span>
      </div>
    );
  } else if (state === 'error') {
    body = <ErrorState description="Scoreboard unavailable." onRetry={onRetry} compact />;
  } else if (state === 'empty' || entries.length === 0) {
    body = <EmptyState title="No risk profiles yet" compact />;
  } else {
    body = (
      <ol className={styles.list}>
        {entries.map((e) => {
          const expanded = open === e.id;
          const panelId = `${baseId}-${e.id}`;
          return (
            <li key={e.id} className={styles.item}>
              <div className={styles.row}>
                <span className={styles.rank}>
                  <span className="sr-only">Rank </span>
                  {e.rank}
                </span>
                <Avatar name={e.name} size="sm" />
                <span className={styles.who}>
                  {onOpenEntry ? (
                    <button
                      type="button"
                      className={styles.name}
                      onClick={() => {
                        onOpenEntry(e.id);
                      }}
                    >
                      {e.name}
                    </button>
                  ) : (
                    <span className={styles.nameText}>{e.name}</span>
                  )}
                  {e.department && <span className={styles.dept}>{e.department}</span>}
                </span>
                <span className={styles.score}>
                  {e.compositeScore}
                  <span className="sr-only"> composite score</span>
                </span>
                <RiskChip level={e.riskLevel} size="sm" />
                <button
                  type="button"
                  className={styles.toggle}
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() => {
                    setOpen(expanded ? null : e.id);
                  }}
                >
                  {expanded ? (
                    <ChevronDown aria-hidden="true" size={18} />
                  ) : (
                    <ChevronRight aria-hidden="true" size={18} />
                  )}
                  <span className="sr-only">Risk breakdown for {e.name}</span>
                </button>
              </div>
              <div id={panelId} hidden={!expanded} className={styles.panel}>
                {expanded && (
                  <RiskBreakdown
                    scores={e.scores}
                    composite={e.compositeScore}
                    level={e.riskLevel}
                    headingLevel={4}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <section aria-labelledby={`${baseId}-h`} className={cx(styles.root, className)}>
      <Heading id={`${baseId}-h`} className={styles.title}>
        {title}
      </Heading>
      {body}
    </section>
  );
}
