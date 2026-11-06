import { cx } from '../../lib/cx';
import styles from './Avatar.module.css';

export interface AvatarProps {
  name: string;
  /** Bundled or data: image URL. Falls back to initials. */
  src?: string | undefined;
  size?: 'sm' | 'md' | 'lg' | undefined;
  /**
   * Decorative by default (the name is shown next to it). Set false when the avatar is the only
   * identifier, so it gets an accessible name.
   */
  decorative?: boolean | undefined;
  className?: string | undefined;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

export function Avatar({ name, src, size = 'md', decorative = true, className }: AvatarProps) {
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img', 'aria-label': name };
  return (
    <span {...a11y} className={cx(styles.root, styles[size], className)}>
      {src ? <img src={src} alt="" className={styles.img} /> : initials(name)}
    </span>
  );
}
