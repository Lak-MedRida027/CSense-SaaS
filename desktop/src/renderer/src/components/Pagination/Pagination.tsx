import { ChevronLeft, ChevronRight } from '../../icons';
import { cx } from '../../lib/cx';
import { IconButton } from '../IconButton';
import styles from './Pagination.module.css';

export interface PaginationProps {
  /** 1-based. */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Max numbered buttons shown around the current page. */
  siblingCount?: number | undefined;
  label?: string | undefined;
  className?: string | undefined;
}

function pageList(page: number, count: number, siblings: number): (number | 'gap')[] {
  const pages = new Set<number>([1, count]);
  for (let p = page - siblings; p <= page + siblings; p += 1)
    if (p >= 1 && p <= count) pages.add(p);
  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1];
    if (prev !== undefined && p - prev > 1) out.push('gap');
    out.push(p);
  });
  return out;
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
  siblingCount = 1,
  label = 'Pagination',
  className,
}: PaginationProps) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label={label} className={cx(styles.root, className)}>
      <IconButton
        icon={ChevronLeft}
        label="Previous page"
        disabled={page <= 1}
        onClick={() => {
          onPageChange(page - 1);
        }}
      />
      <ol className={styles.list}>
        {pageList(page, pageCount, siblingCount).map((p, i) =>
          p === 'gap' ? (
            <li key={`gap-${i}`} aria-hidden="true" className={styles.gap}>
              …
            </li>
          ) : (
            <li key={p}>
              <button
                type="button"
                className={cx(styles.page, p === page && styles.current)}
                aria-current={p === page ? 'page' : undefined}
                aria-label={`Page ${p}`}
                onClick={() => {
                  onPageChange(p);
                }}
              >
                {p}
              </button>
            </li>
          ),
        )}
      </ol>
      <IconButton
        icon={ChevronRight}
        label="Next page"
        disabled={page >= pageCount}
        onClick={() => {
          onPageChange(page + 1);
        }}
      />
    </nav>
  );
}
