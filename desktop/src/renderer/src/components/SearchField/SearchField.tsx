import { Search, X } from '../../icons';
import { cx } from '../../lib/cx';
import { IconButton } from '../IconButton';
import { LiveRegion } from '../LiveRegion';
import { TextField } from '../TextField';
import styles from './SearchField.module.css';

export interface SearchFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | undefined;
  /** Announced politely, e.g. "12 employees found". */
  resultCountText?: string | undefined;
  hideLabel?: boolean | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

/** Search landmark with a clear button and a polite result-count announcement. */
export function SearchField({
  label,
  value,
  onChange,
  placeholder,
  resultCountText,
  hideLabel = true,
  disabled,
  className,
}: SearchFieldProps) {
  return (
    <div role="search" className={cx(styles.root, className)}>
      <TextField
        type="search"
        label={label}
        hideLabel={hideLabel}
        leadingIcon={Search}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.currentTarget.value);
        }}
        endAdornment={
          value ? (
            <IconButton
              icon={X}
              label="Clear search"
              size="sm"
              onClick={() => {
                onChange('');
              }}
            />
          ) : undefined
        }
      />
      <LiveRegion>{resultCountText}</LiveRegion>
    </div>
  );
}
