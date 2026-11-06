import type { CSSProperties } from 'react';
import { cx } from '../../lib/cx';
import styles from './Skeleton.module.css';

export interface SkeletonProps {
  width?: CSSProperties['width'] | undefined;
  height?: CSSProperties['height'] | undefined;
  shape?: 'rect' | 'text' | 'circle' | undefined;
  className?: string | undefined;
}

/**
 * Decorative loading placeholder (aria-hidden). The surrounding region must expose the loading
 * state itself, e.g. `aria-busy="true"` plus a Spinner or "Loading..." text.
 */
export function Skeleton({ width, height, shape = 'rect', className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(styles.root, styles[shape], className)}
      style={{ width, height }}
    />
  );
}

export interface SkeletonTextProps {
  lines?: number | undefined;
  className?: string | undefined;
}

export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <span aria-hidden="true" className={cx(styles.lines, className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} shape="text" width={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </span>
  );
}
