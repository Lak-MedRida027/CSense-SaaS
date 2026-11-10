import { useState, type ReactNode, type SyntheticEvent } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { LockdownBanner, type LockdownState } from '../../components/LockdownBanner';
import { cx } from '../../lib/cx';
import styles from './LockdownShell.module.css';

export interface LockdownShellProps {
  lockdownState: LockdownState;
  /** Seam: user confirmed leaving. Engineers end the attempt and ask main to exit lockdown. */
  onConfirmExit: () => void;
  /** Quiz content; only rendered while lockdown is `active`. */
  children: ReactNode;
  /** Shown instead of the quiz while entering/exiting/failed. */
  pendingContent?: ReactNode | undefined;
  exitTitle?: string | undefined;
  exitDescription?: string | undefined;
  /** Banner notice, e.g. the focus-loss warning (role=alert, polite). */
  warning?: string | undefined;
  className?: string | undefined;
}

const prevent = (e: SyntheticEvent): void => {
  e.preventDefault();
};

/**
 * Frame for quizzes in kiosk/lockdown mode. Owns the persistent banner and the exit confirmation.
 * Questions are not rendered until the main process reports lockdown as active.
 */
export function LockdownShell({
  lockdownState,
  onConfirmExit,
  children,
  pendingContent,
  exitTitle = 'Leave the quiz?',
  exitDescription = "Your answers won't be saved and this counts as an attempt.",
  warning,
  className,
}: LockdownShellProps) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div
      className={cx(styles.shell, className)}
      data-lockdown={lockdownState}
      // Second layer: the main process blocks these keys and clears the clipboard (ADR 0016).
      onCopy={prevent}
      onCut={prevent}
      onPaste={prevent}
      onContextMenu={prevent}
      onDragStart={prevent}
      onAuxClick={prevent}
    >
      <LockdownBanner
        state={lockdownState}
        warning={warning}
        onRequestExit={() => {
          setConfirming(true);
        }}
      />
      <main className={styles.main}>{lockdownState === 'active' ? children : pendingContent}</main>
      <ConfirmDialog
        open={confirming && lockdownState === 'active'}
        title={exitTitle}
        description={exitDescription}
        confirmLabel="Leave quiz"
        cancelLabel="Keep going"
        tone="danger"
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          setConfirming(false);
          onConfirmExit();
        }}
      />
    </div>
  );
}
