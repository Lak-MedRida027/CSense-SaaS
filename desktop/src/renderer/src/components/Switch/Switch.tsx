import { useId, type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import styles from './Switch.module.css';

export interface SwitchProps {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: ReactNode | undefined;
  disabled?: boolean | undefined;
  /** Visible state text so on/off is not conveyed by position or colour alone. */
  onLabel?: string | undefined;
  offLabel?: string | undefined;
  className?: string | undefined;
}

export function Switch({
  label,
  checked,
  onChange,
  description,
  disabled = false,
  onLabel = 'On',
  offLabel = 'Off',
  className,
}: SwitchProps) {
  const id = useId();
  const descId = `${id}-desc`;
  return (
    <div className={cx(styles.root, className)}>
      <span className={styles.text}>
        <span id={`${id}-label`} className={styles.label}>
          {label}
        </span>
        {description && (
          <span id={descId} className={styles.description}>
            {description}
          </span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? descId : undefined}
        disabled={disabled}
        className={styles.switch}
        onClick={() => {
          onChange(!checked);
        }}
      >
        <span className={styles.track} aria-hidden="true">
          <span className={styles.thumb} />
        </span>
        <span className={styles.state} aria-hidden="true">
          {checked ? onLabel : offLabel}
        </span>
      </button>
    </div>
  );
}
