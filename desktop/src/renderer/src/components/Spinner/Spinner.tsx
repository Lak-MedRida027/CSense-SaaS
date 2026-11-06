import { LoaderCircle } from '../../icons';
import { cx } from '../../lib/cx';
import styles from './Spinner.module.css';

export interface SpinnerProps {
  /** Announced to screen readers. Ignored when `decorative`. */
  label?: string | undefined;
  size?: 'sm' | 'md' | 'lg' | undefined;
  /** Use inside a control that already exposes `aria-busy`. */
  decorative?: boolean | undefined;
  className?: string | undefined;
}

const PX = { sm: 16, md: 20, lg: 32 } as const;

export function Spinner({ label = 'Loading', size = 'md', decorative, className }: SpinnerProps) {
  const icon = <LoaderCircle aria-hidden="true" size={PX[size]} className={styles.icon} />;
  if (decorative) return <span className={cx(styles.root, className)}>{icon}</span>;
  return (
    <span role="status" className={cx(styles.root, className)}>
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}
