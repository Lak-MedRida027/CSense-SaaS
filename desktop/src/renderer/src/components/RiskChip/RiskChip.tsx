import type { RiskLevel } from '@csense/shared';
import { riskTokens } from '../../design/tokens/risk';
import { Circle, riskIcon } from '../../icons';
import { cx } from '../../lib/cx';
import { Skeleton } from '../Skeleton';
import styles from './RiskChip.module.css';

export interface RiskChipProps {
  /** `null` = not assessed yet. */
  level: RiskLevel | null;
  size?: 'sm' | 'md' | undefined;
  /** Append the governance state, e.g. "High risk (Red)". */
  showGovernance?: boolean | undefined;
  loading?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Risk band chip. Band = icon shape + text + colour (Low shield-check, Medium triangle,
 * High octagon), so it is never colour-only. Governance state is in the accessible name.
 */
export function RiskChip({
  level,
  size = 'md',
  showGovernance = false,
  loading = false,
  className,
}: RiskChipProps) {
  if (loading) {
    return (
      <span className={cx(styles.chip, styles[size], className)} aria-busy="true">
        <Skeleton shape="text" width="5rem" />
        <span className="sr-only">Loading risk level</span>
      </span>
    );
  }
  if (level === null) {
    return (
      <span className={cx(styles.chip, styles.none, styles[size], className)} data-tone="neutral">
        <Circle aria-hidden="true" size={size === 'sm' ? 12 : 14} />
        Not assessed
      </span>
    );
  }
  const token = riskTokens[level];
  const Icon = riskIcon[token.icon];
  return (
    <span className={cx(styles.chip, styles[size], className)} data-risk={level}>
      <Icon aria-hidden="true" size={size === 'sm' ? 14 : 16} />
      {token.label}
      {showGovernance ? (
        <span className={styles.gov}> ({token.governance})</span>
      ) : (
        <span className="sr-only"> ({token.governance} governance state)</span>
      )}
    </span>
  );
}
