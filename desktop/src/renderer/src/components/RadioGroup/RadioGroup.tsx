import { useId, type ReactNode } from 'react';
import { OctagonAlert } from '../../icons';
import { cx } from '../../lib/cx';
import styles from './RadioGroup.module.css';

export interface RadioOption {
  value: string;
  label: ReactNode;
  description?: ReactNode | undefined;
  disabled?: boolean | undefined;
}

export interface RadioGroupProps {
  legend: ReactNode;
  options: readonly RadioOption[];
  value: string | null;
  onChange: (value: string) => void;
  name?: string | undefined;
  hint?: ReactNode | undefined;
  error?: ReactNode | undefined;
  disabled?: boolean | undefined;
  orientation?: 'vertical' | 'horizontal' | undefined;
  hideLegend?: boolean | undefined;
  className?: string | undefined;
}

/** Native radios in a fieldset: arrow keys move selection, Tab leaves the group. */
export function RadioGroup({
  legend,
  options,
  value,
  onChange,
  name,
  hint,
  error,
  disabled = false,
  orientation = 'vertical',
  hideLegend = false,
  className,
}: RadioGroupProps) {
  const autoId = useId();
  const groupName = name ?? autoId;
  const hintId = `${autoId}-hint`;
  const errId = `${autoId}-err`;
  const describedBy =
    [hint ? hintId : null, error ? errId : null].filter(Boolean).join(' ') || undefined;

  return (
    <fieldset
      className={cx(styles.root, className)}
      disabled={disabled}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
    >
      <legend className={cx(styles.legend, hideLegend && 'sr-only')}>{legend}</legend>
      {hint && (
        <div id={hintId} className={styles.hint}>
          {hint}
        </div>
      )}
      <div className={cx(styles.options, styles[orientation])}>
        {options.map((opt) => {
          const id = `${autoId}-${opt.value}`;
          return (
            <label key={opt.value} htmlFor={id} className={styles.option}>
              <input
                id={id}
                type="radio"
                name={groupName}
                value={opt.value}
                checked={value === opt.value}
                disabled={opt.disabled}
                onChange={() => {
                  onChange(opt.value);
                }}
                className={styles.input}
              />
              <span className={styles.dot} aria-hidden="true" />
              <span className={styles.text}>
                <span>{opt.label}</span>
                {opt.description && <span className={styles.description}>{opt.description}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {error && (
        <div id={errId} className={styles.error}>
          <OctagonAlert aria-hidden="true" size={16} />
          {error}
        </div>
      )}
    </fieldset>
  );
}
