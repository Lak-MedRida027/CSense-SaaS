import type { ReactNode } from 'react';
import type { StatusTone } from '../../design/tokens';
import { statusIcon, X } from '../../icons';
import { cx } from '../../lib/cx';
import { IconButton } from '../IconButton';
import styles from './Alert.module.css';

export interface AlertProps {
  tone: StatusTone;
  title: ReactNode;
  children?: ReactNode;
  /** Optional action (e.g. a Button). */
  action?: ReactNode | undefined;
  onDismiss?: (() => void) | undefined;
  /**
   * `critical` alerts use role="alert" (assertive) by default; others use role="status".
   * Set `announce={false}` for static callouts that should not be announced on mount.
   */
  announce?: boolean | undefined;
  className?: string | undefined;
}

/** Inline callout. Tone is conveyed by icon shape and title text, not just colour. */
export function Alert({
  tone,
  title,
  children,
  action,
  onDismiss,
  announce = true,
  className,
}: AlertProps) {
  const Icon = statusIcon[tone];
  const role = announce ? (tone === 'critical' ? 'alert' : 'status') : undefined;
  return (
    <div role={role} className={cx(styles.root, styles[tone], className)}>
      <Icon aria-hidden="true" size={20} className={styles.icon} />
      <div className={styles.body}>
        <p className={styles.title}>{title}</p>
        {children && <div className={styles.content}>{children}</div>}
        {action && <div className={styles.action}>{action}</div>}
      </div>
      {onDismiss && <IconButton icon={X} label="Dismiss" size="sm" onClick={onDismiss} />}
    </div>
  );
}
