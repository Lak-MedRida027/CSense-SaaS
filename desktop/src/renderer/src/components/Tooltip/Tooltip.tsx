import { cloneElement, useEffect, useId, useState, type ReactElement, type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import styles from './Tooltip.module.css';

interface DescribableProps {
  'aria-describedby'?: string | undefined;
}

export interface TooltipProps {
  content: ReactNode;
  /** The trigger: a single focusable element, so the tooltip also appears on keyboard focus. */
  children: ReactElement<DescribableProps>;
  placement?: 'top' | 'bottom' | undefined;
  /**
   * `describe` (default) links the tooltip to the trigger via aria-describedby.
   * `visual` hides it from assistive tech when the trigger's accessible name already says the
   * same thing (e.g. an IconButton whose aria-label equals the tooltip text).
   */
  mode?: 'describe' | 'visual' | undefined;
  className?: string | undefined;
}

/**
 * Hover + focus tooltip, dismissible with Escape (WCAG 1.4.13). Never the only place essential
 * information lives.
 */
export function Tooltip({
  content,
  children,
  placement = 'top',
  mode = 'describe',
  className,
}: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const existing = children.props['aria-describedby'];
  const trigger =
    mode === 'describe'
      ? cloneElement(children, {
          'aria-describedby': existing ? `${existing} ${id}` : id,
        })
      : children;

  return (
    // The wrapper only observes hover/focus bubbling from its focusable child.
    <span
      className={cx(styles.wrapper, className)}
      onMouseEnter={() => {
        setOpen(true);
      }}
      onMouseLeave={() => {
        setOpen(false);
      }}
      onFocus={() => {
        setOpen(true);
      }}
      onBlur={() => {
        setOpen(false);
      }}
    >
      {trigger}
      <span
        id={id}
        role={mode === 'describe' ? 'tooltip' : undefined}
        aria-hidden={mode === 'visual' ? true : undefined}
        className={cx(styles.tip, styles[placement], open && styles.open)}
      >
        {content}
      </span>
    </span>
  );
}
