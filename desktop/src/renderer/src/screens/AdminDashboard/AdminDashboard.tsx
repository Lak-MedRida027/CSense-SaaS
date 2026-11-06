import { RISK_LEVELS } from '@csense/shared';
import { useMemo, useState } from 'react';
import { BarChart } from '../../components/BarChart';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DataTable, type DataTableColumn } from '../../components/DataTable';
import { Dialog } from '../../components/Dialog';
import { EscalationList } from '../../components/EscalationList';
import { FilterBar } from '../../components/FilterBar';
import { LevelChip } from '../../components/LevelChip';
import { Pagination } from '../../components/Pagination';
import { RadioGroup } from '../../components/RadioGroup';
import { RiskChip } from '../../components/RiskChip';
import { Scoreboard } from '../../components/Scoreboard';
import { SearchField } from '../../components/SearchField';
import { Select } from '../../components/Select';
import { StatTile } from '../../components/StatTile';
import {
  BookOpen,
  ChartColumn,
  ClipboardCheck,
  FileChartColumn,
  GraduationCap,
  LayoutDashboard,
  Mail,
  OctagonAlert,
  ShieldAlert,
  TriangleAlert,
  UserCog,
  Users,
} from '../../icons';
import { AppShell, type AppNavItem } from '../../layouts/AppShell';
import type {
  AdminDashboardScreenProps,
  EmployeeRow,
  EmployeeSortKey,
} from './AdminDashboard.types';
import styles from './AdminDashboard.module.css';

function employeeColumns(
  onOpenEmployee: (id: string) => void,
): readonly DataTableColumn<EmployeeRow, EmployeeSortKey>[] {
  return [
    {
      key: 'name',
      header: 'Name',
      render: (r) => (
        <button
          type="button"
          className={styles.nameButton}
          onClick={() => {
            onOpenEmployee(r.id);
          }}
        >
          {r.name}
        </button>
      ),
      sortable: true,
      isRowHeader: true,
    },
    { key: 'department', header: 'Department', render: (r) => r.department, sortable: true },
    {
      key: 'modules',
      header: 'Modules',
      render: (r) => `${r.modulesCompleted}/${r.modulesTotal}`,
      sortable: true,
      align: 'end',
    },
    {
      key: 'level',
      header: 'Level',
      render: (r) => <LevelChip level={r.level} size="sm" compact />,
      sortable: true,
    },
    { key: 'lastActive', header: 'Last active', render: (r) => r.lastActiveText, sortable: true },
    {
      key: 'risk',
      header: 'Risk',
      render: (r) => <RiskChip level={r.riskLevel} size="sm" />,
      sortable: true,
    },
  ];
}

/** Security-team overview: KPIs, completion by module, employee progress, risk and escalations. */
export function AdminDashboardScreen({
  adminName,
  kpis,
  kpiState = 'ready',
  moduleCompletion,
  moduleCompletionState = 'ready',
  employees,
  employeesState = 'ready',
  totalEmployees,
  sort,
  filters,
  departments,
  page,
  pageCount,
  riskScoreboard,
  riskState = 'ready',
  escalations,
  escalationsState = 'ready',
  featureFlags,
  reportKinds,
  generatingReport = false,
  onSortChange,
  onFilterChange,
  onPageChange,
  onOpenEmployee,
  onReviewEscalation,
  onGenerateReport,
  onOpenKpi,
  onNavigate,
  onRetry,
  onOpenSettings,
  onSignOut,
}: AdminDashboardScreenProps) {
  const [reportOpen, setReportOpen] = useState(false);
  const columns = useMemo(() => employeeColumns(onOpenEmployee), [onOpenEmployee]);
  const [reportKind, setReportKind] = useState<string | null>(reportKinds[0]?.id ?? null);

  const nav: AppNavItem[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'employees', label: 'Employees', icon: Users },
    { id: 'modules', label: 'Modules', icon: BookOpen },
    { id: 'final', label: 'Final assessment', icon: GraduationCap },
    { id: 'risk', label: 'Risk and governance', icon: ShieldAlert, count: kpis.openEscalations },
    ...(featureFlags.phishing
      ? [{ id: 'phishing', label: 'Phishing simulations', icon: Mail }]
      : []),
    { id: 'reports', label: 'Reports', icon: FileChartColumn },
    { id: 'users', label: 'User accounts', icon: UserCog },
  ];

  const activeFilters =
    (filters.search ? 1 : 0) + (filters.department ? 1 : 0) + (filters.risk ? 1 : 0);
  const drill = (id: 'completion' | 'avg-score' | 'high-risk' | 'escalations') =>
    onOpenKpi
      ? () => {
          onOpenKpi(id);
        }
      : undefined;

  return (
    <AppShell
      areaLabel="Admin"
      navItems={nav}
      currentNavId="overview"
      onNavigate={onNavigate}
      user={{ name: adminName, roleLabel: 'Security team' }}
      onOpenSettings={onOpenSettings}
      onSignOut={onSignOut}
      title="Overview"
      headerActions={
        <Button
          variant="secondary"
          iconStart={FileChartColumn}
          loading={generatingReport}
          onClick={() => {
            setReportOpen(true);
          }}
        >
          Generate report
        </Button>
      }
    >
      <div className={styles.layout}>
        <section aria-label="Key metrics" className={styles.kpis}>
          <StatTile
            label="Training completion"
            value={kpis.completionRatePercent}
            unit="%"
            delta={kpis.completionDelta}
            icon={ClipboardCheck}
            tone="info"
            state={kpiState}
            onActivate={drill('completion')}
          />
          <StatTile
            label="Average quiz score"
            value={kpis.avgQuizScorePercent}
            unit="%"
            icon={ChartColumn}
            tone="neutral"
            state={kpiState}
            onActivate={drill('avg-score')}
          />
          <StatTile
            label="High-risk employees"
            value={kpis.highRiskCount}
            unit={kpis.highRiskCount === 1 ? 'person' : 'people'}
            icon={OctagonAlert}
            tone="critical"
            state={kpiState}
            onActivate={drill('high-risk')}
          />
          <StatTile
            label="Open escalations"
            value={kpis.openEscalations}
            icon={TriangleAlert}
            tone="caution"
            state={kpiState}
            onActivate={drill('escalations')}
          />
        </section>

        <Card className={styles.full}>
          <BarChart
            title="Completion by module"
            data={moduleCompletion}
            valueHeader="Completed"
            state={moduleCompletionState}
            onRetry={() => onRetry?.('modules')}
          />
        </Card>

        <section aria-label="Employee progress" className={styles.full}>
          <div className={styles.tableTools}>
            <FilterBar
              label="Filter employees"
              activeCount={activeFilters}
              onClear={() => {
                onFilterChange({ search: '', department: '', risk: '' });
              }}
            >
              <SearchField
                label="Search employees"
                placeholder="Search by name"
                value={filters.search}
                onChange={(search) => {
                  onFilterChange({ ...filters, search });
                }}
                resultCountText={
                  employeesState === 'ready' ? `${totalEmployees} employees found` : undefined
                }
              />
              <Select
                label="Department"
                hideLabel
                placeholder="All departments"
                value={filters.department}
                options={departments.map((d) => ({ value: d, label: d }))}
                onChange={(e) => {
                  onFilterChange({ ...filters, department: e.currentTarget.value });
                }}
              />
              <Select
                label="Risk band"
                hideLabel
                placeholder="All risk bands"
                value={filters.risk}
                options={RISK_LEVELS.map((r) => ({ value: r, label: `${r} risk` }))}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  onFilterChange({ ...filters, risk: RISK_LEVELS.find((r) => r === v) ?? '' });
                }}
              />
            </FilterBar>
          </div>
          <DataTable
            caption={`Employee progress (${totalEmployees})`}
            columns={columns}
            rows={employees}
            rowKey={(r) => r.id}
            sort={sort}
            onSortChange={onSortChange}
            state={employeesState}
            emptyTitle="No employees match these filters"
            onRetry={() => onRetry?.('employees')}
          />
          <div className={styles.tableFooter}>
            <Pagination page={page} pageCount={pageCount} onPageChange={onPageChange} />
          </div>
        </section>

        <Card className={styles.scoreboard}>
          <Scoreboard
            title="Risk scoreboard (highest first)"
            entries={riskScoreboard}
            onOpenEntry={onOpenEmployee}
            state={riskState}
            onRetry={() => onRetry?.('risk')}
          />
        </Card>

        <Card className={styles.escalations}>
          <EscalationList
            title="Escalations"
            items={escalations}
            onReview={onReviewEscalation}
            state={escalationsState}
            onRetry={() => onRetry?.('escalations')}
          />
        </Card>
      </div>

      <Dialog
        open={reportOpen}
        title="Generate report"
        description="Reports cover the current filters and date range."
        onClose={() => {
          setReportOpen(false);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setReportOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              softDisabled={!reportKind}
              onClick={() => {
                if (!reportKind) return;
                setReportOpen(false);
                onGenerateReport(reportKind);
              }}
            >
              Generate
            </Button>
          </>
        }
      >
        <RadioGroup
          legend="Report type"
          value={reportKind}
          onChange={setReportKind}
          options={reportKinds.map((k) => ({
            value: k.id,
            label: k.label,
            description: k.description,
          }))}
        />
      </Dialog>
    </AppShell>
  );
}
