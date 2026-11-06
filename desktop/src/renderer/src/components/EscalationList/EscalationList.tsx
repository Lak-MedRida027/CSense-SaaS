import { useId } from 'react';
import { OctagonAlert, ShieldCheck, TriangleAlert } from '../../icons';
import { cx } from '../../lib/cx';
import { Button } from '../Button';
import { EmptyState } from '../EmptyState';
import { ErrorState } from '../ErrorState';
import { SkeletonText } from '../Skeleton';
import styles from './EscalationList.module.css';

export interface EscalationItem {
  id: string;
  severity: 'critical' | 'caution';
  /** e.g. "Credential submitted in simulation". */
  title: string;
  employeeName: string;
  /** Pre-formatted time, e.g. "Today 10:42". */
  occurredAtText: string;
  status: 'open' | 'in_review';
}

export interface EscalationListProps {
  title: string;
  items: readonly EscalationItem[];
  /** Seam: open the governance review for an escalation. */
  onReview?: ((id: string) => void) | undefined;
  state?: 'ready' | 'loading' | 'error' | undefined;
  onRetry?: (() => void) | undefined;
  headingLevel?: 2 | 3 | undefined;
  className?: string | undefined;
}

const SEVERITY = {
  critical: { label: 'Critical', icon: OctagonAlert },
  caution: { label: 'Elevated', icon: TriangleAlert },
} as const;

export function EscalationList({
  title,
  items,
  onReview,
  state = 'ready',
  onRetry,
  headingLevel = 2,
  className,
}: EscalationListProps) {
  const headingId = useId();
  const Heading = `h${headingLevel}` as const;

  let body;
  if (state === 'loading') {
    body = (
      <div aria-busy="true">
        <SkeletonText lines={4} />
        <span className="sr-only">Loading escalations</span>
      </div>
    );
  } else if (state === 'error') {
    body = <ErrorState description="Escalations unavailable." onRetry={onRetry} compact />;
  } else if (items.length === 0) {
    body = <EmptyState icon={ShieldCheck} title="No open escalations" compact />;
  } else {
    body = (
      <ul className={styles.list}>
        {items.map((it) => {
          const sev = SEVERITY[it.severity];
          const Icon = sev.icon;
          return (
            <li key={it.id} className={styles.item} data-tone={it.severity}>
              <Icon aria-hidden="true" size={18} className={styles.icon} />
              <div className={styles.body}>
                <p className={styles.title}>
                  <span className={styles.severity}>{sev.label}:</span> {it.title}
                </p>
                <p className={styles.meta}>
                  {it.employeeName} · {it.occurredAtText}
                  {it.status === 'in_review' && ' · In review'}
                </p>
              </div>
              {onReview && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onReview(it.id);
                  }}
                  aria-label={`Review: ${it.title}, ${it.employeeName}`}
                >
                  Review
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section aria-labelledby={headingId} className={cx(styles.root, className)}>
      <Heading id={headingId} className={styles.heading}>
        {title}
        {state === 'ready' && items.length > 0 && (
          <span className={styles.count}>{items.length}</span>
        )}
      </Heading>
      {body}
    </section>
  );
}
