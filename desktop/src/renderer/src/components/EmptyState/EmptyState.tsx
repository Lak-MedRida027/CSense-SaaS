import type { ReactNode } from 'react';
import type { LucideIcon } from '../../icons';
import { cx } from '../../lib/cx';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  title: string;
  description?: ReactNode | undefined;
  icon?: LucideIcon | undefined;
  /** Decorative illustration URL (rendered with empty alt). */
  illustration?: string | undefined;
  /** The next action, e.g. a Button. */
  action?: ReactNode | undefined;
  compact?: boolean | undefined;
  className?: string | undefined;
}

export function EmptyState({
  title,
  description,
  icon: Icon,
  illustration,
  action,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div className={cx(styles.root, compact && styles.compact, className)}>
      {illustration && <img src={illustration} alt="" className={styles.illustration} />}
      {!illustration && Icon && (
        <Icon aria-hidden="true" size={compact ? 24 : 32} className={styles.icon} />
      )}
      <p className={styles.title}>{title}</p>
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
