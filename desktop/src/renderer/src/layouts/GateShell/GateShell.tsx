import type { ReactNode } from 'react';
import { BrandLogo } from '../../components/BrandLogo';
import { Lock, type LucideIcon } from '../../icons';
import { cx } from '../../lib/cx';
import styles from './GateShell.module.css';

export interface GateShellProps {
  children: ReactNode;
  /** Top-right status, e.g. "Workstation locked". */
  statusText?: string | undefined;
  statusIcon?: LucideIcon | undefined;
  /** Footer text/links, e.g. help contact and app version. */
  footer?: ReactNode | undefined;
  className?: string | undefined;
}

/**
 * Full-screen, chrome-free frame for the pre-access security gate and sign-in. The window is
 * kiosk-managed by the main process (Phase 5); this is presentation only.
 */
export function GateShell({
  children,
  statusText,
  statusIcon: StatusIcon = Lock,
  footer,
  className,
}: GateShellProps) {
  return (
    <div className={cx(styles.shell, className)}>
      <header className={styles.header}>
        <BrandLogo variant="wordmark" height={36} />
        {statusText && (
          <p className={styles.status}>
            <StatusIcon aria-hidden="true" size={16} />
            {statusText}
          </p>
        )}
      </header>
      <main className={styles.main}>{children}</main>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </div>
  );
}
