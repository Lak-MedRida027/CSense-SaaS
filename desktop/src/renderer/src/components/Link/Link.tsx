import type { ComponentPropsWithRef, ReactNode } from 'react';
import { ExternalLink } from '../../icons';
import { cx } from '../../lib/cx';
import styles from './Link.module.css';

export interface LinkProps extends Omit<ComponentPropsWithRef<'a'>, 'children'> {
  children: ReactNode;
  /**
   * External https links open in the OS browser (the main process denies new windows and hands
   * https URLs to the shell). Adds an icon and a screen-reader hint.
   */
  external?: boolean | undefined;
  tone?: 'default' | 'subtle' | undefined;
}

/** Always underlined so links are never identified by colour alone (WCAG 1.4.1). */
export function Link({
  children,
  external = false,
  tone = 'default',
  className,
  ...rest
}: LinkProps) {
  return (
    <a
      {...rest}
      className={cx(styles.root, styles[tone], className)}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {children}
      {external && (
        <>
          <ExternalLink aria-hidden="true" size={14} className={styles.icon} />
          <span className="sr-only"> (opens in browser)</span>
        </>
      )}
    </a>
  );
}
