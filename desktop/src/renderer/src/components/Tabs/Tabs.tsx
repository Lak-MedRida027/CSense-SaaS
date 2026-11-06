import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import styles from './Tabs.module.css';

export interface TabItem {
  id: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean | undefined;
  /** Optional count badge, e.g. "3". Announced as part of the tab name. */
  count?: number | undefined;
}

export interface TabsProps {
  /** Accessible name for the tab list. */
  label: string;
  items: readonly TabItem[];
  /** Controlled selection; omit for uncontrolled. */
  selectedId?: string | undefined;
  defaultSelectedId?: string | undefined;
  onSelect?: ((id: string) => void) | undefined;
  className?: string | undefined;
}

/** WAI-ARIA tabs with automatic activation: Arrow keys, Home and End move between tabs. */
export function Tabs({
  label,
  items,
  selectedId,
  defaultSelectedId,
  onSelect,
  className,
}: TabsProps) {
  const baseId = useId();
  const [internal, setInternal] = useState(defaultSelectedId ?? items[0]?.id);
  const current = selectedId ?? internal;
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const enabled = items.filter((i) => !i.disabled);

  const select = (id: string) => {
    setInternal(id);
    onSelect?.(id);
    refs.current.get(id)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const idx = enabled.findIndex((i) => i.id === current);
    let next: (typeof enabled)[number] | undefined;
    if (e.key === 'ArrowRight') next = enabled[(idx + 1) % enabled.length];
    else if (e.key === 'ArrowLeft') next = enabled[(idx - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    if (next) {
      e.preventDefault();
      select(next.id);
    }
  };

  return (
    <div className={cx(styles.root, className)}>
      <div role="tablist" aria-label={label} className={styles.list}>
        {items.map((item) => {
          const selected = item.id === current;
          return (
            <button
              key={item.id}
              ref={(el) => {
                if (el) refs.current.set(item.id, el);
                else refs.current.delete(item.id);
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              className={styles.tab}
              onKeyDown={onKeyDown}
              onClick={() => {
                select(item.id);
              }}
            >
              {item.label}
              {item.count !== undefined && <span className={styles.count}>{item.count}</span>}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${baseId}-panel-${item.id}`}
          aria-labelledby={`${baseId}-tab-${item.id}`}
          hidden={item.id !== current}
          tabIndex={0}
          className={styles.panel}
        >
          {item.id === current && item.content}
        </div>
      ))}
    </div>
  );
}
