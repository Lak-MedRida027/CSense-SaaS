import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';
import { Check, OctagonAlert } from '../../icons';
import { cx } from '../../lib/cx';
import styles from './Checkbox.module.css';

export interface CheckboxProps extends Omit<ComponentPropsWithRef<'input'>, 'type'> {
  label: ReactNode;
  description?: ReactNode | undefined;
  error?: ReactNode | undefined;
}

/** Native checkbox with a custom visual; the whole row is the 44px click target. */
export function Checkbox({ label, description, error, id, className, ...rest }: CheckboxProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const descId = `${inputId}-desc`;
  const errId = `${inputId}-err`;
  const describedBy =
    [description ? descId : null, error ? errId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cx(styles.root, className)}>
      <label htmlFor={inputId} className={styles.row}>
        <input
          {...rest}
          id={inputId}
          type="checkbox"
          className={styles.input}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
        <span className={styles.box} aria-hidden="true">
          <Check size={14} strokeWidth={3} className={styles.tick} />
        </span>
        <span className={styles.text}>
          <span className={styles.label}>{label}</span>
        </span>
      </label>
      {description && (
        <span id={descId} className={styles.description}>
          {description}
        </span>
      )}
      {error && (
        <div id={errId} className={styles.error}>
          <OctagonAlert aria-hidden="true" size={16} />
          {error}
        </div>
      )}
    </div>
  );
}
