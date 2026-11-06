import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest('[inert]') && el.getAttribute('aria-hidden') !== 'true',
  );
}

export interface FocusTrapProps {
  children: ReactNode;
  /** Element to focus on mount; defaults to the first focusable descendant. */
  initialFocusRef?: RefObject<HTMLElement | null> | undefined;
  /** Return focus to the previously focused element on unmount (default true). */
  restoreFocus?: boolean | undefined;
  active?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Keeps Tab / Shift+Tab inside its children while active and restores focus on unmount.
 * Used by Dialog. Never trap without a visible, focusable way out.
 */
export function FocusTrap({
  children,
  initialFocusRef,
  restoreFocus = true,
  active = true,
  className,
}: FocusTrapProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = rootRef.current;
    const target = initialFocusRef?.current ?? (root ? getFocusable(root)[0] : undefined) ?? root;
    target?.focus();
    return () => {
      if (restoreFocus) previous?.focus();
    };
  }, [active, initialFocusRef, restoreFocus]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!active || e.key !== 'Tab' || !rootRef.current) return;
    const items = getFocusable(rootRef.current);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      e.preventDefault();
      return;
    }
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    // The wrapper only intercepts Tab to keep focus inside; it is not itself interactive.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div ref={rootRef} className={className} onKeyDown={onKeyDown} tabIndex={-1}>
      {children}
    </div>
  );
}
