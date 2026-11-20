import type { ModuleCardData } from '../../components/ModuleCard';
import type { EmployeePageProps } from '../employeeNav';

export interface ModulesScreenProps extends EmployeePageProps {
  modules: readonly ModuleCardData[];
  /** Unlock rule text per locked module id. */
  lockedReasons: Readonly<Record<string, string>>;
  onOpenModule: (moduleId: string) => void;
}
