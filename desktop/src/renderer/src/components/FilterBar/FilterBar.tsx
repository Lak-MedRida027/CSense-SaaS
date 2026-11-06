import type { ReactNode } from 'react';
import { RotateCcw } from '../../icons';
import { cx } from '../../lib/cx';
import { Button } from '../Button';
import styles from './FilterBar.module.css';

export interface FilterBarProps {
  /** Accessible name for the group, e.g. "Filter employees". */
  label: string;
  /** SearchField, Selects, etc. */
  children: ReactNode;
  /** Seam: reset filters. The button shows only when `activeCount > 0`. */
  onClear?: (() => void) | undefined;
  activeCount?: number | undefined;
  className?: string | undefined;
}

export function FilterBar({
  label,
  children,
  onClear,
  activeCount = 0,
  className,
}: FilterBarProps) {
  return (
    <div role="group" aria-label={label} className={cx(styles.root, className)}>
      {children}
      {onClear && activeCount > 0 && (
        <Button variant="ghost" size="sm" iconStart={RotateCcw} onClick={onClear}>
          Clear filters ({activeCount})
        </Button>
      )}
    </div>
  );
}
