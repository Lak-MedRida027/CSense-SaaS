import { useId, useState } from 'react';
import { cx } from '../../lib/cx';
import { Button } from '../Button';
import { DataTable } from '../DataTable';
import { EmptyState } from '../EmptyState';
import { ErrorState } from '../ErrorState';
import { SkeletonText } from '../Skeleton';
import styles from './BarChart.module.css';

export interface BarDatum {
  id: string;
  label: string;
  value: number;
  /** Printed value, e.g. "96%". Defaults to `${value}${unit}`. */
  valueText?: string | undefined;
}

export interface BarChartProps {
  title: string;
  data: readonly BarDatum[];
  max?: number | undefined;
  unit?: string | undefined;
  /** Header for the value column in table view. */
  valueHeader?: string | undefined;
  state?: 'ready' | 'loading' | 'empty' | 'error' | undefined;
  onRetry?: (() => void) | undefined;
  headingLevel?: 2 | 3 | undefined;
  className?: string | undefined;
}

/**
 * Horizontal HTML bar chart with printed values and a "View as table" toggle, so the data is
 * never available only as bar length or colour.
 */
export function BarChart({
  title,
  data,
  max = 100,
  unit = '%',
  valueHeader = 'Value',
  state = 'ready',
  onRetry,
  headingLevel = 2,
  className,
}: BarChartProps) {
  const [asTable, setAsTable] = useState(false);
  const headingId = useId();
  const Heading = `h${headingLevel}` as const;
  const text = (d: BarDatum) => d.valueText ?? `${d.value}${unit}`;

  let body;
  if (state === 'loading') {
    body = (
      <div aria-busy="true">
        <SkeletonText lines={data.length || 5} />
        <span className="sr-only">Loading chart</span>
      </div>
    );
  } else if (state === 'error') {
    body = <ErrorState description="Chart data could not be loaded." onRetry={onRetry} compact />;
  } else if (state === 'empty' || data.length === 0) {
    body = <EmptyState title="No data yet" compact />;
  } else if (asTable) {
    body = (
      <DataTable
        caption={title}
        hideCaption
        rows={data}
        rowKey={(d) => d.id}
        columns={[
          { key: 'label', header: 'Item', render: (d) => d.label, isRowHeader: true },
          { key: 'value', header: valueHeader, render: text, align: 'end' },
        ]}
      />
    );
  } else {
    body = (
      <ul className={styles.list}>
        {data.map((d) => {
          const pct = max > 0 ? Math.min(Math.max(d.value / max, 0), 1) * 100 : 0;
          return (
            <li key={d.id} className={styles.row}>
              <span className={styles.label}>{d.label}</span>
              <span className={styles.track} aria-hidden="true">
                <span className={styles.bar} style={{ width: `${pct}%` }} />
              </span>
              <span className={styles.value}>{text(d)}</span>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section aria-labelledby={headingId} className={cx(styles.root, className)}>
      <header className={styles.header}>
        <Heading id={headingId} className={styles.title}>
          {title}
        </Heading>
        {state === 'ready' && data.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={asTable}
            onClick={() => {
              setAsTable((t) => !t);
            }}
          >
            {asTable ? 'View as chart' : 'View as table'}
          </Button>
        )}
      </header>
      {body}
    </section>
  );
}
