import { useTheme } from '../../design/theme/useTheme';
import { cx } from '../../lib/cx';
import styles from './BrandLogo.module.css';

export interface BrandLogoProps {
  variant?: 'mark' | 'wordmark' | undefined;
  /** Rendered height in px. */
  height?: number | undefined;
  /** Decorative when the app name is already visible next to it. */
  decorative?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Validated brand logo for the active theme. Falls back to the CSense default when a client
 * asset is missing or rejected (see validateBrand), and to the app name as text as a last resort.
 */
export function BrandLogo({
  variant = 'wordmark',
  height = 32,
  decorative = false,
  className,
}: BrandLogoProps) {
  const { brand, resolvedTheme } = useTheme();
  const asset = variant === 'mark' ? brand.logoMark : brand.logoWordmark;
  const alt = decorative ? '' : brand.appName;
  if (!asset) {
    return (
      <span className={cx(styles.text, className)} aria-hidden={decorative || undefined}>
        {brand.appName}
      </span>
    );
  }
  return (
    <img
      src={asset[resolvedTheme]}
      alt={alt}
      height={height}
      className={cx(styles.img, className)}
      style={{ height }}
      draggable={false}
    />
  );
}
