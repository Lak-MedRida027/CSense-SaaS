import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';
import { ChevronDown, OctagonAlert } from '../../icons';
import { cx } from '../../lib/cx';
import { Spinner } from '../Spinner';
import field from '../TextField/TextField.module.css';
import styles from './Select.module.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean | undefined;
}

export interface SelectProps extends Omit<ComponentPropsWithRef<'select'>, 'children'> {
  label: string;
  options: readonly SelectOption[];
  placeholder?: string | undefined;
  hint?: ReactNode | undefined;
  error?: ReactNode | undefined;
  loading?: boolean | undefined;
  hideLabel?: boolean | undefined;
  /** Shown as the only (disabled) option when `options` is empty. */
  emptyLabel?: string | undefined;
}

/** Native <select> for full keyboard and screen-reader support, with token styling. */
export function Select({
  label,
  options,
  placeholder,
  hint,
  error,
  loading = false,
  hideLabel = false,
  emptyLabel = 'No options available',
  id,
  className,
  disabled,
  ...rest
}: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const hintId = `${selectId}-hint`;
  const errId = `${selectId}-err`;
  const empty = options.length === 0;
  const describedBy =
    [hint ? hintId : null, error ? errId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cx(field.field, (disabled || loading || empty) && field.isDisabled, className)}>
      <label htmlFor={selectId} className={cx(field.label, hideLabel && 'sr-only')}>
        {label}
      </label>
      {hint && (
        <div id={hintId} className={field.hint}>
          {hint}
        </div>
      )}
      <div className={cx(field.control, Boolean(error) && field.hasError)}>
        <select
          {...rest}
          id={selectId}
          disabled={disabled || loading || empty}
          aria-busy={loading || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cx(field.input, styles.select)}
        >
          {empty ? (
            <option value="">{emptyLabel}</option>
          ) : (
            <>
              {placeholder !== undefined && <option value="">{placeholder}</option>}
              {options.map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </option>
              ))}
            </>
          )}
        </select>
        <span className={styles.chevron} aria-hidden="true">
          {loading ? <Spinner decorative size="sm" /> : <ChevronDown size={18} />}
        </span>
      </div>
      {error && (
        <div id={errId} className={field.error}>
          <OctagonAlert aria-hidden="true" size={16} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
