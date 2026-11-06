import type { FeatureFlags, Level, RiskLevel } from '@csense/shared';
import type { BarDatum } from '../../components/BarChart';
import type { SortState } from '../../components/DataTable';
import type { EscalationItem } from '../../components/EscalationList';
import type { ScoreboardEntry } from '../../components/Scoreboard';
import type { StatDelta } from '../../components/StatTile';

export interface AdminKpis {
  completionRatePercent: number;
  completionDelta?: StatDelta | undefined;
  avgQuizScorePercent: number;
  highRiskCount: number;
  openEscalations: number;
}

export interface EmployeeRow {
  id: string;
  name: string;
  department: string;
  modulesCompleted: number;
  modulesTotal: number;
  level: Level;
  /** Pre-formatted, e.g. "2h ago". */
  lastActiveText: string;
  riskLevel: RiskLevel | null;
}

export type EmployeeSortKey = 'name' | 'department' | 'modules' | 'level' | 'lastActive' | 'risk';

export interface EmployeeFilters {
  search: string;
  /** '' = all departments. */
  department: string;
  /** '' = all bands. */
  risk: RiskLevel | '';
}

export interface ReportKind {
  id: string;
  label: string;
  description: string;
}

export type ViewStatus = 'ready' | 'loading' | 'error';

export interface AdminDashboardScreenProps {
  adminName: string;
  kpis: AdminKpis;
  kpiState?: ViewStatus | undefined;
  moduleCompletion: readonly BarDatum[];
  moduleCompletionState?: ViewStatus | undefined;

  employees: readonly EmployeeRow[];
  employeesState?: ViewStatus | undefined;
  totalEmployees: number;
  sort: SortState<EmployeeSortKey>;
  filters: EmployeeFilters;
  departments: readonly string[];
  page: number;
  pageCount: number;

  riskScoreboard: readonly ScoreboardEntry[];
  riskState?: ViewStatus | undefined;
  escalations: readonly EscalationItem[];
  escalationsState?: ViewStatus | undefined;

  /** Phishing nav only renders when `featureFlags.phishing` is on (D16). */
  featureFlags: FeatureFlags;
  reportKinds: readonly ReportKind[];
  /** True while a report is being generated. */
  generatingReport?: boolean | undefined;

  onSortChange: (sort: SortState<EmployeeSortKey>) => void;
  onFilterChange: (filters: EmployeeFilters) => void;
  onPageChange: (page: number) => void;
  onOpenEmployee: (employeeId: string) => void;
  onReviewEscalation: (escalationId: string) => void;
  onGenerateReport: (reportKindId: string) => void;
  /** KPI drill-down, e.g. "high-risk" opens the filtered table. */
  onOpenKpi?:
    ((kpiId: 'completion' | 'avg-score' | 'high-risk' | 'escalations') => void) | undefined;
  onNavigate: (navId: string) => void;
  onRetry?:
    ((section: 'kpis' | 'modules' | 'employees' | 'risk' | 'escalations') => void) | undefined;
  onOpenSettings?: (() => void) | undefined;
  onSignOut?: (() => void) | undefined;
}
