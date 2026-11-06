import type { ReactNode } from 'react';
import { Check, OctagonAlert } from '../../icons';
import { cx } from '../../lib/cx';
import styles from './Stepper.module.css';

export type StepStatus = 'complete' | 'current' | 'upcoming' | 'error';

export interface StepItem {
  id: string;
  label: ReactNode;
  status: StepStatus;
}

export interface StepperProps {
  /** Accessible name, e.g. "Sign-in progress". */
  label: string;
  steps: readonly StepItem[];
  orientation?: 'horizontal' | 'vertical' | undefined;
  className?: string | undefined;
}

const STATUS_TEXT: Record<StepStatus, string> = {
  complete: 'completed',
  current: 'current step',
  upcoming: 'not started',
  error: 'needs attention',
};

/** Progress through a sequence. Status is shown by icon/number, weight and hidden text. */
export function Stepper({ label, steps, orientation = 'horizontal', className }: StepperProps) {
  return (
    <nav aria-label={label} className={className}>
      <ol className={cx(styles.list, styles[orientation])}>
        {steps.map((step, i) => (
          <li
            key={step.id}
            className={cx(styles.step, styles[step.status])}
            aria-current={step.status === 'current' ? 'step' : undefined}
          >
            <span className={styles.marker} aria-hidden="true">
              {step.status === 'complete' ? (
                <Check size={16} strokeWidth={3} />
              ) : step.status === 'error' ? (
                <OctagonAlert size={16} />
              ) : (
                i + 1
              )}
            </span>
            <span className={styles.label}>
              {step.label}
              <span className="sr-only">, {STATUS_TEXT[step.status]}</span>
            </span>
            {i < steps.length - 1 && <span className={styles.connector} aria-hidden="true" />}
          </li>
        ))}
      </ol>
    </nav>
  );
}
