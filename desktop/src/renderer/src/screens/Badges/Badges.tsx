import { Alert } from '../../components/Alert';
import { BadgeGrid } from '../../components/BadgeGrid';
import { Card } from '../../components/Card';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { AppShell } from '../../layouts/AppShell';
import { EMPLOYEE_NAV } from '../employeeNav';
import type { BadgesScreenProps } from './Badges.types';
import styles from '../employeePage.module.css';

/** Every badge: earned ones filled, the rest outlined with a lock and text. */
export function BadgesScreen({
  employee,
  badges,
  state = 'ready',
  errorDescription,
  notice,
  onRetry,
  onNavigate,
  onOpenSettings,
  onSignOut,
}: BadgesScreenProps) {
  const earned = badges.filter((b) => b.earned).length;
  let content;
  if (state === 'loading') {
    content = <Skeleton shape="rect" height={200} />;
  } else if (state === 'error') {
    content = (
      <ErrorState
        description={errorDescription ?? 'Your badges could not be loaded.'}
        onRetry={onRetry}
      />
    );
  } else {
    content = (
      <Card title={`Earned ${String(earned)} of ${String(badges.length)}`}>
        <BadgeGrid
          label="Your badges"
          badges={badges}
          state={badges.length === 0 ? 'empty' : 'ready'}
        />
      </Card>
    );
  }
  return (
    <AppShell
      navItems={EMPLOYEE_NAV}
      currentNavId="badges"
      onNavigate={onNavigate}
      user={{ name: employee.name, roleLabel: 'Employee' }}
      onOpenSettings={onOpenSettings}
      onSignOut={onSignOut}
      title="Badges"
    >
      <div className={styles.stack}>
        {notice && <Alert tone={notice.tone} title={notice.text} announce={false} />}
        {content}
      </div>
    </AppShell>
  );
}
