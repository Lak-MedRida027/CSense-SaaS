import type { ComponentPropsWithRef, MouseEvent } from 'react';
import type { LucideIcon } from '../../icons';
import { cx } from '../../lib/cx';
import { Spinner } from '../Spinner';
import { Tooltip } from '../Tooltip';
import styles from './IconButton.module.css';

export interface IconButtonProps extends Omit<
  ComponentPropsWithRef<'button'>,
  'children' | 'aria-label'
> {
  icon: LucideIcon;
  /** Required accessible name; also shown as the tooltip. */
  label: string;
  variant?: 'ghost' | 'secondary' | undefined;
  /** `sm` is 32px visually with a 44px hit area. */
  size?: 'sm' | 'md' | undefined;
  loading?: boolean | undefined;
  /** Hide the hover/focus tooltip (e.g. when a visible text label is adjacent). */
  hideTooltip?: boolean | undefined;
  tooltipPlacement?: 'top' | 'bottom' | undefined;
}

export function IconButton({
  icon: Icon,
  label,
  variant = 'ghost',
  size = 'md',
  loading = false,
  hideTooltip = false,
  tooltipPlacement = 'top',
  className,
  type = 'button',
  onClick,
  ...rest
}: IconButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  const button = (
    <button
      {...rest}
      type={type}
      aria-label={label}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      className={cx(styles.root, styles[variant], styles[size], className)}
      onClick={handleClick}
    >
      {loading ? (
        <Spinner decorative size="sm" />
      ) : (
        <Icon aria-hidden="true" size={size === 'sm' ? 16 : 20} />
      )}
    </button>
  );

  if (hideTooltip) return button;
  return (
    <Tooltip content={label} mode="visual" placement={tooltipPlacement}>
      {button}
    </Tooltip>
  );
}
