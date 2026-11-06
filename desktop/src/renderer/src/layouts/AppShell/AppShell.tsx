import type { ReactNode } from 'react';
import { Avatar } from '../../components/Avatar';
import { BrandLogo } from '../../components/BrandLogo';
import { IconButton } from '../../components/IconButton';
import { LogOut, Settings, type LucideIcon } from '../../icons';
import { cx } from '../../lib/cx';
import styles from './AppShell.module.css';

export interface AppNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Optional count, e.g. open escalations. */
  count?: number | undefined;
}

export interface AppShellProps {
  /** Small label under the logo, e.g. "Admin". */
  areaLabel?: string | undefined;
  navItems: readonly AppNavItem[];
  currentNavId: string;
  /** Seam: route change. */
  onNavigate: (id: string) => void;
  user: { name: string; roleLabel: string };
  onOpenSettings?: (() => void) | undefined;
  /** Seam: sign out (auth is wired by engineers). */
  onSignOut?: (() => void) | undefined;
  /** Page heading (h1). */
  title: ReactNode;
  /** Right side of the page header (primary page actions). */
  headerActions?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
}

/** Authenticated app frame: skip link, sidebar nav, page header and main landmark. */
export function AppShell({
  areaLabel,
  navItems,
  currentNavId,
  onNavigate,
  user,
  onOpenSettings,
  onSignOut,
  title,
  headerActions,
  children,
  className,
}: AppShellProps) {
  return (
    <div className={cx(styles.shell, className)}>
      <a href="#main-content" className={styles.skip}>
        Skip to content
      </a>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <BrandLogo variant="wordmark" height={32} />
          {areaLabel && <span className={styles.area}>{areaLabel}</span>}
        </div>
        <nav aria-label="Main">
          <ul className={styles.nav}>
            {navItems.map((item) => {
              const Icon = item.icon;
              const current = item.id === currentNavId;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={cx(styles.navItem, current && styles.current)}
                    aria-current={current ? 'page' : undefined}
                    onClick={() => {
                      onNavigate(item.id);
                    }}
                  >
                    <Icon aria-hidden="true" size={18} />
                    <span className={styles.navLabel}>{item.label}</span>
                    {item.count !== undefined && item.count > 0 && (
                      <span className={styles.count}>
                        {item.count}
                        <span className="sr-only"> open</span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className={styles.user}>
          <Avatar name={user.name} size="md" />
          <div className={styles.userText}>
            <span className={styles.userName}>{user.name}</span>
            <span className={styles.userRole}>{user.roleLabel}</span>
          </div>
          {onOpenSettings && (
            <IconButton icon={Settings} label="Settings" size="sm" onClick={onOpenSettings} />
          )}
          {onSignOut && <IconButton icon={LogOut} label="Sign out" size="sm" onClick={onSignOut} />}
        </div>
      </aside>
      <div className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>{title}</h1>
          {headerActions && <div className={styles.actions}>{headerActions}</div>}
        </header>
        <main id="main-content" tabIndex={-1} className={styles.main}>
          {children}
        </main>
      </div>
    </div>
  );
}
