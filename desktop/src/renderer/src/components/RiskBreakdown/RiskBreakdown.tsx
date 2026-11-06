import { RISK_DIMENSIONS, RISK_WEIGHTS, type RiskDimension, type RiskLevel } from '@csense/shared';
import { cx } from '../../lib/cx';
import type { ViewState } from '../Card';
import { ErrorState } from '../ErrorState';
import { ProgressBar } from '../ProgressBar';
import { RiskChip } from '../RiskChip';
import { SkeletonText } from '../Skeleton';
import styles from './RiskBreakdown.module.css';

export interface RiskBreakdownProps {
  /** Sub-scores 0-100 per dimension (RiskProfileDTO). */
  scores: Readonly<Record<RiskDimension, number>>;
  /** Composite score as computed by the shared risk engine. Not computed here. */
  composite: number;
  level: RiskLevel;
  /** Defaults to the shared fixed weights; passed in for display only. */
  weights?: Readonly<Record<RiskDimension, number>> | undefined;
  state?: ViewState | undefined;
  onRetry?: (() => void) | undefined;
  headingLevel?: 3 | 4 | undefined;
  className?: string | undefined;
}

const DIMENSION_LABEL: Record<RiskDimension, string> = {
  knowledge: 'Knowledge',
  behavioural: 'Behavioural',
  simulation: 'Simulation',
  engagement: 'Engagement',
};

/** Four weighted dimensions as labelled bars with printed values, plus the composite and band. */
export function RiskBreakdown({
  scores,
  composite,
  level,
  weights = RISK_WEIGHTS,
  state = 'ready',
  onRetry,
  headingLevel = 3,
  className,
}: RiskBreakdownProps) {
  const Heading = `h${headingLevel}` as const;
  if (state === 'loading') {
    return (
      <div aria-busy="true" className={className}>
        <SkeletonText lines={4} />
        <span className="sr-only">Loading risk breakdown</span>
      </div>
    );
  }
  if (state === 'error')
    return <ErrorState description="Risk profile unavailable." onRetry={onRetry} compact />;
  if (state === 'empty') return <p className={styles.empty}>Not assessed yet.</p>;

  return (
    <div className={cx(styles.root, className)}>
      <div className={styles.summary}>
        <Heading className={styles.heading}>
          Composite score <span className={styles.composite}>{composite}</span>
          <span className={styles.outOf}> / 100</span>
        </Heading>
        <RiskChip level={level} showGovernance />
      </div>
      <ul className={styles.list}>
        {RISK_DIMENSIONS.map((d) => (
          <li key={d}>
            <ProgressBar
              label={`${DIMENSION_LABEL[d]} (weight ${Math.round(weights[d] * 100)}%)`}
              value={scores[d]}
              valueText={`${scores[d]} / 100`}
              tone="neutral"
              size="sm"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
