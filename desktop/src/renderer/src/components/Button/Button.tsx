import type { ComponentPropsWithRef, MouseEvent, ReactNode } from 'react';
import type { LucideIcon } from '../../icons';
import { cx } from '../../lib/cx';
import { Spinner } from '../Spinner';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  children: ReactNode;
  variant?: ButtonVariant | undefined;
  /** `sm` is 32px visually but keeps a 44px hit area. */
  size?: ButtonSize | undefined;
  /** Shows a spinner, sets aria-busy and ignores clicks while keeping focus and width. */
  loading?: boolean | undefined;
  iconStart?: LucideIcon | undefined;
  iconEnd?: LucideIcon | undefined;
  fullWidth?: boolean | undefined;
  /**
   * Disabled but still focusable (aria-disabled), so users can discover why via a tooltip or
   * description. Prefer this over `disabled` when the reason matters.
   */
  softDisabled?: boolean | undefined;
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  iconStart: IconStart,
  iconEnd: IconEnd,
  fullWidth = false,
  softDisabled = false,
  className,
  type = 'button',
  onClick,
  ...rest
}: ButtonProps) {
  const inert = loading || softDisabled;
  const iconSize = size === 'lg' ? 20 : size === 'sm' ? 16 : 18;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (inert) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <button
      {...rest}
      type={type}
      className={cx(
        styles.root,
        styles[variant],
        styles[size],
        fullWidth && styles.fullWidth,
        loading && styles.loading,
        className,
      )}
      aria-busy={loading || undefined}
      aria-disabled={inert || undefined}
      onClick={handleClick}
    >
      <span className={styles.content}>
        {IconStart && <IconStart aria-hidden="true" size={iconSize} />}
        <span>{children}</span>
        {IconEnd && <IconEnd aria-hidden="true" size={iconSize} />}
      </span>
      {loading && (
        <Spinner decorative size={size === 'lg' ? 'md' : 'sm'} className={styles.spinner} />
      )}
    </button>
  );
}
