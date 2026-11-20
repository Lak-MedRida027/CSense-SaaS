import { Award, BookOpen, GraduationCap, LayoutDashboard } from '../icons';

/** The employee sidebar, shared by every AppShell page (plan 7.1). */
export const EMPLOYEE_NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'modules', label: 'Modules', icon: BookOpen },
  { id: 'badges', label: 'Badges', icon: Award },
  { id: 'final', label: 'Final assessment', icon: GraduationCap },
] as const;

/** Props every employee page shares. */
export interface EmployeePageProps {
  employee: { name: string };
  onNavigate: (navId: string) => void;
  onOpenSettings?: (() => void) | undefined;
  onSignOut?: (() => void) | undefined;
  state?: 'ready' | 'loading' | 'error' | 'empty' | undefined;
  /** Replaces the default error text (for example when the network is unreachable). */
  errorDescription?: string | undefined;
  notice?: { tone: 'info' | 'caution'; text: string } | undefined;
  onRetry?: (() => void) | undefined;
}
