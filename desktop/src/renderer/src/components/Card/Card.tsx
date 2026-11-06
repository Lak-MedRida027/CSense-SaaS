import { useId, type ElementType, type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { EmptyState } from '../EmptyState';
import { ErrorState } from '../ErrorState';
import { SkeletonText } from '../Skeleton';
import { Spinner } from '../Spinner';
import styles from './Card.module.css';

export type ViewState = 'ready' | 'loading' | 'empty' | 'error';

export interface CardProps {
  children?: ReactNode;
  /** Rendered as the card heading; also labels the card region. */
  title?: ReactNode | undefined;
  headingLevel?: 2 | 3 | 4 | undefined;
  /** Right-aligned header actions (buttons, links). */
  actions?: ReactNode | undefined;
  as?: ElementType | undefined;
  padding?: 'none' | 'md' | 'lg' | undefined;
  elevation?: 'e0' | 'e1' | 'e2' | undefined;
  state?: ViewState | undefined;
  emptyTitle?: string | undefined;
  emptyDescription?: ReactNode | undefined;
  errorMessage?: ReactNode | undefined;
  onRetry?: (() => void) | undefined;
  className?: string | undefined;
}

/**
 * Surface container with built-in loading / empty / error states. For a clickable card, render a
 * heading `<a>`/`<button>` with `className={cardStyles.stretch}` (stretched-link pattern) rather
 * than nesting interactive elements.
 */
export function Card({
  children,
  title,
  headingLevel = 2,
  actions,
  as: Tag = 'section',
  padding = 'md',
  elevation = 'e1',
  state = 'ready',
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  errorMessage = 'This section could not be loaded.',
  onRetry,
  className,
}: CardProps) {
  const headingId = useId();
  const Heading = `h${headingLevel}` as const;

  let body: ReactNode = children;
  if (state === 'loading') {
    body = (
      <div className={styles.loading}>
        <Spinner size="sm" />
        <SkeletonText lines={3} />
      </div>
    );
  } else if (state === 'empty') {
    body = <EmptyState title={emptyTitle} description={emptyDescription} compact />;
  } else if (state === 'error') {
    body = <ErrorState description={errorMessage} onRetry={onRetry} compact />;
  }

  return (
    <Tag
      className={cx(styles.root, styles[`pad-${padding}`], styles[elevation], className)}
      aria-labelledby={title ? headingId : undefined}
      aria-busy={state === 'loading' || undefined}
    >
      {(title ?? actions) && (
        <header className={styles.header}>
          {title && (
            <Heading id={headingId} className={styles.title}>
              {title}
            </Heading>
          )}
          {actions && <div className={styles.actions}>{actions}</div>}
        </header>
      )}
      {body}
    </Tag>
  );
}
