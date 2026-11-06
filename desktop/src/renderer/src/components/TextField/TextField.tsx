import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';
import { OctagonAlert, type LucideIcon } from '../../icons';
import { cx } from '../../lib/cx';
import styles from './TextField.module.css';

export interface TextFieldProps extends Omit<ComponentPropsWithRef<'input'>, 'size'> {
  /** Visible label. Never rely on the placeholder alone. */
  label: string;
  hint?: ReactNode | undefined;
  /** Error message. Sets aria-invalid and is announced via aria-describedby. */
  error?: ReactNode | undefined;
  leadingIcon?: LucideIcon | undefined;
  /** Rendered inside the field's right edge (e.g. the password visibility toggle). */
  endAdornment?: ReactNode | undefined;
  /** Hide the label visually while keeping it for screen readers (e.g. a table search box). */
  hideLabel?: boolean | undefined;
  /** Extra live, polite status line under the field (e.g. "Caps Lock is on"). */
  status?: ReactNode | undefined;
}

export function TextField({
  label,
  hint,
  error,
  leadingIcon: LeadingIcon,
  endAdornment,
  hideLabel = false,
  status,
  id,
  className,
  required,
  disabled,
  ...rest
}: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const statusId = `${inputId}-status`;
  const describedBy =
    [hint ? hintId : null, status ? statusId : null, error ? errorId : null]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div className={cx(styles.field, disabled && styles.isDisabled, className)}>
      <label htmlFor={inputId} className={cx(styles.label, hideLabel && 'sr-only')}>
        {label}
        {required && (
          <span className={styles.required}>
            <span aria-hidden="true"> *</span>
            <span className="sr-only"> (required)</span>
          </span>
        )}
      </label>
      {hint && (
        <div id={hintId} className={styles.hint}>
          {hint}
        </div>
      )}
      <div className={cx(styles.control, Boolean(error) && styles.hasError)}>
        {LeadingIcon && <LeadingIcon aria-hidden="true" size={18} className={styles.leading} />}
        <input
          {...rest}
          id={inputId}
          required={required}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cx(styles.input, LeadingIcon && styles.withLeading)}
        />
        {endAdornment && <div className={styles.end}>{endAdornment}</div>}
      </div>
      <div id={statusId} aria-live="polite" className={styles.status}>
        {status}
      </div>
      {error && (
        <div id={errorId} className={styles.error}>
          <OctagonAlert aria-hidden="true" size={16} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
