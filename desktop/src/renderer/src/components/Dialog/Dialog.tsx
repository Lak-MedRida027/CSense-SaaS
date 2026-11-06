import { useEffect, useId, type ReactNode, type RefObject } from 'react';
import { X } from '../../icons';
import { cx } from '../../lib/cx';
import { FocusTrap } from '../FocusTrap';
import { IconButton } from '../IconButton';
import styles from './Dialog.module.css';

export interface DialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode | undefined;
  children?: ReactNode;
  /** Footer actions, right-aligned. */
  footer?: ReactNode | undefined;
  /** Called on Escape and the close button. */
  onClose: () => void;
  /** `alertdialog` for confirmations that interrupt the user. */
  role?: 'dialog' | 'alertdialog' | undefined;
  /** Hide the X button (e.g. alertdialogs, where Cancel is the way out). */
  hideCloseButton?: boolean | undefined;
  initialFocusRef?: RefObject<HTMLElement | null> | undefined;
  size?: 'sm' | 'md' | 'lg' | undefined;
  className?: string | undefined;
}

/**
 * Modal dialog: aria-modal, focus trapped, Escape closes, focus returns to the trigger.
 * Clicking the scrim does nothing on purpose (avoids accidental dismissal mid-task).
 */
export function Dialog({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  role = 'dialog',
  hideCloseButton = false,
  initialFocusRef,
  size = 'md',
  className,
}: DialogProps) {
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={styles.scrim}>
      <FocusTrap initialFocusRef={initialFocusRef} className={styles.trap}>
        <div
          role={role}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descId : undefined}
          className={cx(styles.dialog, styles[size], className)}
        >
          <header className={styles.header}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {!hideCloseButton && <IconButton icon={X} label="Close" onClick={onClose} />}
          </header>
          {description && (
            <p id={descId} className={styles.description}>
              {description}
            </p>
          )}
          {children && <div className={styles.body}>{children}</div>}
          {footer && <footer className={styles.footer}>{footer}</footer>}
        </div>
      </FocusTrap>
    </div>
  );
}
