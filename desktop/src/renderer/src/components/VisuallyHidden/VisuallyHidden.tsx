import type { ElementType, ReactNode } from 'react';

export interface VisuallyHiddenProps {
  children: ReactNode;
  as?: ElementType | undefined;
  id?: string | undefined;
}

/** Content for screen readers only (uses the global `.sr-only` utility). */
export function VisuallyHidden({ children, as: Tag = 'span', id }: VisuallyHiddenProps) {
  return (
    <Tag className="sr-only" id={id}>
      {children}
    </Tag>
  );
}
