import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';

export interface LiveRegionProps {
  children?: ReactNode;
  /** `polite` waits for the user to be idle; `assertive` interrupts (critical only). */
  politeness?: 'polite' | 'assertive' | undefined;
  /** Hide visually (default). Set false to show the text as well. */
  visuallyHidden?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Announces changing content. Keep it mounted and change its children; a region that mounts
 * with content already inside is often not announced.
 */
export function LiveRegion({
  children,
  politeness = 'polite',
  visuallyHidden = true,
  className,
}: LiveRegionProps) {
  return (
    <div
      role={politeness === 'assertive' ? 'alert' : 'status'}
      aria-live={politeness}
      aria-atomic="true"
      className={cx(visuallyHidden && 'sr-only', className)}
    >
      {children}
    </div>
  );
}
