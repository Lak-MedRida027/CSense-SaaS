import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from '../../icons';
import { cx } from '../../lib/cx';
import { EmptyState } from '../EmptyState';
import { ErrorState } from '../ErrorState';
import { Skeleton } from '../Skeleton';
import styles from './DataTable.module.css';

export type SortDirection = 'asc' | 'desc';

export interface SortState<K extends string = string> {
  key: K;
  direction: SortDirection;
}

export interface DataTableColumn<Row, K extends string = string> {
  key: K;
  header: string;
  render: (row: Row) => ReactNode;
  sortable?: boolean | undefined;
  align?: 'start' | 'end' | 'center' | undefined;
  /** CSS width, e.g. "20%" or "8rem". */
  width?: string | undefined;
  /** Use as the row header (th scope=row) for screen-reader context. */
  isRowHeader?: boolean | undefined;
}

export interface DataTableProps<Row, K extends string = string> {
  /** Visible caption (required for context); can be visually hidden. */
  caption: string;
  hideCaption?: boolean | undefined;
  columns: readonly DataTableColumn<Row, K>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Controlled sort; sorting itself happens server-side / in the engineer's hook. */
  sort?: SortState<K> | undefined;
  onSortChange?: ((sort: SortState<K>) => void) | undefined;
  state?: 'ready' | 'loading' | 'error' | undefined;
  emptyTitle?: string | undefined;
  emptyDescription?: ReactNode | undefined;
  onRetry?: (() => void) | undefined;
  loadingRowCount?: number | undefined;
  className?: string | undefined;
}

const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const;

/** Native table: caption, sortable header buttons with aria-sort, 48px rows. Presentational. */
export function DataTable<Row, K extends string = string>({
  caption,
  hideCaption = false,
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  state = 'ready',
  emptyTitle = 'No results',
  emptyDescription,
  onRetry,
  loadingRowCount = 5,
  className,
}: DataTableProps<Row, K>) {
  const toggle = (key: K) => {
    const direction: SortDirection = sort?.key === key && sort.direction === 'asc' ? 'desc' : 'asc';
    onSortChange?.({ key, direction });
  };

  let body: ReactNode;
  if (state === 'loading') {
    body = Array.from({ length: loadingRowCount }, (_, r) => (
      <tr key={`sk-${r}`} aria-hidden="true">
        {columns.map((c) => (
          <td key={c.key}>
            <Skeleton shape="text" width="70%" />
          </td>
        ))}
      </tr>
    ));
  } else if (state === 'error' || rows.length === 0) {
    body = (
      <tr>
        <td colSpan={columns.length}>
          {state === 'error' ? (
            <ErrorState description="The table could not be loaded." onRetry={onRetry} compact />
          ) : (
            <EmptyState title={emptyTitle} description={emptyDescription} compact />
          )}
        </td>
      </tr>
    );
  } else {
    body = rows.map((row) => (
      <tr key={rowKey(row)}>
        {columns.map((c) => {
          const content = c.render(row);
          const cls = cx(styles[`align-${c.align ?? 'start'}`]);
          return c.isRowHeader ? (
            <th key={c.key} scope="row" className={cls}>
              {content}
            </th>
          ) : (
            <td key={c.key} className={cls}>
              {content}
            </td>
          );
        })}
      </tr>
    ));
  }

  return (
    <div className={cx(styles.wrap, className)}>
      <table className={styles.table} aria-busy={state === 'loading' || undefined}>
        <caption className={cx(styles.caption, hideCaption && 'sr-only')}>
          {caption}
          {state === 'loading' && <span className="sr-only"> (loading)</span>}
        </caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const Icon = active ? (sort.direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
              return (
                <th
                  key={c.key}
                  scope="col"
                  style={c.width ? { width: c.width } : undefined}
                  aria-sort={active ? ARIA_SORT[sort.direction] : undefined}
                  className={cx(styles[`align-${c.align ?? 'start'}`])}
                >
                  {c.sortable && onSortChange ? (
                    <button
                      type="button"
                      className={cx(styles.sort, active && styles.sortActive)}
                      onClick={() => {
                        toggle(c.key);
                      }}
                    >
                      {c.header}
                      <Icon aria-hidden="true" size={14} />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  );
}
