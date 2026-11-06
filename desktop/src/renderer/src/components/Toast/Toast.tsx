import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { StatusTone } from '../../design/tokens';
import { statusIcon, X } from '../../icons';
import { cx } from '../../lib/cx';
import { IconButton } from '../IconButton';
import styles from './Toast.module.css';

/** Toasts never auto-dismiss faster than this (WCAG 2.2.1 timing). */
export const TOAST_MIN_DURATION_MS = 6000;

export interface ToastItem {
  id: string;
  tone: StatusTone;
  message: ReactNode;
  action?: ReactNode | undefined;
  /** Auto-dismiss delay; clamped to at least 6s. `null` keeps it until dismissed. */
  durationMs?: number | null | undefined;
}

export interface ToastProps extends ToastItem {
  onDismiss: (id: string) => void;
}

export function Toast({
  id,
  tone,
  message,
  action,
  durationMs = TOAST_MIN_DURATION_MS,
  onDismiss,
}: ToastProps) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(
    durationMs === null ? null : Math.max(durationMs, TOAST_MIN_DURATION_MS),
  );
  const Icon = statusIcon[tone];

  useEffect(() => {
    if (paused || remaining.current === null) return undefined;
    const started = Date.now();
    const timer = window.setTimeout(() => {
      onDismiss(id);
    }, remaining.current);
    return () => {
      window.clearTimeout(timer);
      if (remaining.current !== null) remaining.current -= Date.now() - started;
    };
  }, [paused, id, onDismiss]);

  return (
    // Pausing on hover/focus is a passive observer of bubbled events, not an interaction.
    <div
      className={cx(styles.toast, styles[tone])}
      onMouseEnter={() => {
        setPaused(true);
      }}
      onMouseLeave={() => {
        setPaused(false);
      }}
      onFocus={() => {
        setPaused(true);
      }}
      onBlur={() => {
        setPaused(false);
      }}
    >
      <Icon aria-hidden="true" size={20} className={styles.icon} />
      <div className={styles.message}>{message}</div>
      {action}
      <IconButton
        icon={X}
        label="Dismiss notification"
        size="sm"
        onClick={() => {
          onDismiss(id);
        }}
      />
    </div>
  );
}

export interface ToastRegionProps {
  toasts: readonly ToastItem[];
  onDismiss: (id: string) => void;
}

/**
 * Fixed, polite live region that stacks toasts. Keep it mounted for the app lifetime so
 * announcements fire. Toasts never carry the only copy of critical information.
 */
export function ToastRegion({ toasts, onDismiss }: ToastRegionProps) {
  return (
    <section aria-label="Notifications" className={styles.region}>
      <div role="status" aria-live="polite" className={styles.stack}>
        {toasts.map((t) => (
          <Toast key={t.id} {...t} onDismiss={onDismiss} />
        ))}
      </div>
    </section>
  );
}
