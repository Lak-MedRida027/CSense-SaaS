import { Alert } from '../../components/Alert';
import { LayoutDashboard } from '../../icons';
import { AppShell } from '../../layouts/AppShell';

export interface AdminHomeScreenProps {
  name: string;
  onSignOut: () => void;
  onOpenSettings?: (() => void) | undefined;
}

/** Placeholder for administrators until the console ships (Phase 7). */
export function AdminHomeScreen({ name, onSignOut, onOpenSettings }: AdminHomeScreenProps) {
  return (
    <AppShell
      navItems={[{ id: 'home', label: 'Welcome', icon: LayoutDashboard }]}
      currentNavId="home"
      onNavigate={() => undefined}
      user={{ name, roleLabel: 'Administrator' }}
      onOpenSettings={onOpenSettings}
      onSignOut={onSignOut}
      title="Welcome"
    >
      <Alert tone="info" title="Admin console arrives in a later release" announce={false}>
        Your administrator account is signed in. Management tools are not part of this version.
      </Alert>
    </AppShell>
  );
}
