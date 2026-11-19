import { Alert } from '../../components/Alert';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { ModuleCard } from '../../components/ModuleCard';
import { Skeleton } from '../../components/Skeleton';
import { BookOpen } from '../../icons';
import { AppShell } from '../../layouts/AppShell';
import { EMPLOYEE_NAV } from '../employeeNav';
import type { ModulesScreenProps } from './Modules.types';
import styles from '../employeePage.module.css';

/** All modules in order. Locked cards stay visible with their unlock rule. */
export function ModulesScreen({
  employee,
  modules,
  lockedReasons,
  state = 'ready',
  errorDescription,
  notice,
  onRetry,
  onOpenModule,
  onNavigate,
  onOpenSettings,
  onSignOut,
}: ModulesScreenProps) {
  let content;
  if (state === 'loading') {
    content = (
      <ul className={styles.list} aria-busy="true" aria-label="Loading modules">
        {[0, 1, 2].map((i) => (
          <li key={i}>
            <Skeleton shape="rect" height={160} />
          </li>
        ))}
      </ul>
    );
  } else if (state === 'error') {
    content = (
      <ErrorState
        description={errorDescription ?? 'Your modules could not be loaded.'}
        onRetry={onRetry}
      />
    );
  } else if (state === 'empty' || modules.length === 0) {
    content = (
      <EmptyState
        icon={BookOpen}
        title="No training has been assigned yet"
        description="Your security team will add modules."
      />
    );
  } else {
    content = (
      <ul className={styles.list}>
        {modules.map((m) => (
          <li key={m.id}>
            <ModuleCard
              module={m}
              totalModules={modules.length}
              lockedReason={lockedReasons[m.id]}
              onOpen={onOpenModule}
              headingLevel={2}
            />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <AppShell
      navItems={EMPLOYEE_NAV}
      currentNavId="modules"
      onNavigate={onNavigate}
      user={{ name: employee.name, roleLabel: 'Employee' }}
      onOpenSettings={onOpenSettings}
      onSignOut={onSignOut}
      title="Modules"
    >
      <div className={styles.stack}>
        {notice && <Alert tone={notice.tone} title={notice.text} announce={false} />}
        {content}
      </div>
    </AppShell>
  );
}
