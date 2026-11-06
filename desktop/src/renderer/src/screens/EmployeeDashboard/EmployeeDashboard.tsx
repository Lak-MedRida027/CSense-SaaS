import { useId } from 'react';
import { BadgeGrid } from '../../components/BadgeGrid';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { LevelChip } from '../../components/LevelChip';
import { LevelLadder } from '../../components/LevelLadder';
import { ModuleCard } from '../../components/ModuleCard';
import { ProgressBar } from '../../components/ProgressBar';
import { ProgressRing } from '../../components/ProgressRing';
import { Spinner } from '../../components/Spinner';
import { XPBar } from '../../components/XPBar';
import {
  ArrowRight,
  Award,
  BookOpen,
  Clock,
  GraduationCap,
  LayoutDashboard,
  Lock,
  Play,
} from '../../icons';
import { AppShell } from '../../layouts/AppShell';
import type { EmployeeDashboardScreenProps } from './EmployeeDashboard.types';
import styles from './EmployeeDashboard.module.css';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'modules', label: 'Modules', icon: BookOpen },
  { id: 'badges', label: 'Badges', icon: Award },
  { id: 'final', label: 'Final assessment', icon: GraduationCap },
] as const;

const fmt = new Intl.NumberFormat('en');

/** Employee home: one primary action (resume), then progress, modules, badges and the ladder. */
export function EmployeeDashboardScreen({
  employee,
  xp,
  modules,
  lockedReasons,
  nextModuleId,
  badges,
  finalAssessment,
  state = 'ready',
  onRetry,
  onOpenModule,
  onOpenBadge,
  onStartFinalAssessment,
  onNavigate,
  onOpenSettings,
  onSignOut,
}: EmployeeDashboardScreenProps) {
  const modulesHeading = useId();
  const firstName = employee.name.split(' ')[0] ?? employee.name;
  const completed = modules.filter((m) => m.status === 'completed').length;
  const total = modules.length;
  const next = modules.find((m) => m.id === nextModuleId);
  const firstTime =
    modules.every((m) => m.status === 'locked' || m.status === 'unlocked') && completed === 0;
  const ringMax = xp.nextLevelXP !== undefined ? xp.nextLevelXP - xp.currentLevelFloorXP : 1;
  const ringValue = xp.nextLevelXP !== undefined ? employee.totalXP - xp.currentLevelFloorXP : 1;

  let content;
  if (state === 'loading') {
    content = (
      <div className={styles.loading} aria-busy="true">
        <Spinner size="lg" label="Loading your dashboard" />
      </div>
    );
  } else if (state === 'error') {
    content = <ErrorState description="Your dashboard could not be loaded." onRetry={onRetry} />;
  } else {
    content = (
      <div className={styles.grid}>
        <Card title="Your level" className={styles.levelCard}>
          <div className={styles.levelBody}>
            <ProgressRing
              label="Progress to next level"
              value={ringValue}
              max={ringMax}
              level={employee.level}
              valueText={`${fmt.format(employee.totalXP)} XP`}
              size={120}
            >
              <span className={styles.ringXp}>{fmt.format(employee.totalXP)}</span>
              <span className={styles.ringUnit}>XP</span>
            </ProgressRing>
            <div className={styles.levelText}>
              <LevelChip level={employee.level} size="lg" />
              <XPBar
                totalXP={employee.totalXP}
                currentLevel={employee.level}
                currentLevelFloorXP={xp.currentLevelFloorXP}
                nextLevelXP={xp.nextLevelXP}
                nextLevel={xp.nextLevel}
              />
            </div>
          </div>
        </Card>

        <Card title={firstTime ? 'Start your training' : 'Up next'} className={styles.nextCard}>
          {next ? (
            <div className={styles.nextBody}>
              <p className={styles.nextEyebrow}>
                Module {next.order} of {total}
              </p>
              <p className={styles.nextTitle}>{next.title}</p>
              <p className={styles.nextMeta}>
                {next.format === 'video' ? (
                  <Play aria-hidden="true" size={14} />
                ) : (
                  <BookOpen aria-hidden="true" size={14} />
                )}
                {next.format === 'video' ? 'Video' : 'Interactive'}
                <Clock aria-hidden="true" size={14} />
                About {next.durationMinutes} min
              </p>
              <Button
                size="lg"
                iconEnd={ArrowRight}
                onClick={() => {
                  onOpenModule(next.id);
                }}
              >
                {next.status === 'in_progress' ? 'Resume module' : 'Start module'}
              </Button>
            </div>
          ) : (
            <EmptyState
              icon={GraduationCap}
              title="All modules complete"
              description="Take the final assessment to finish your training."
              compact
            />
          )}
        </Card>

        <section className={styles.modules} aria-labelledby={modulesHeading}>
          <div className={styles.sectionHeader}>
            <h2 id={modulesHeading} className={styles.sectionTitle}>
              Your modules
            </h2>
            <ProgressBar
              label="Modules complete"
              value={completed}
              max={total}
              valueText={`${completed} of ${total} complete`}
              tone="success"
              className={styles.modulesProgress}
            />
          </div>
          <ul className={styles.moduleGrid}>
            {modules.map((m) => (
              <li key={m.id}>
                <ModuleCard
                  module={m}
                  totalModules={total}
                  lockedReason={lockedReasons[m.id]}
                  onOpen={onOpenModule}
                />
              </li>
            ))}
          </ul>
        </section>

        <Card
          title={`Badges (${badges.filter((b) => b.earned).length} of ${badges.length})`}
          className={styles.wide}
        >
          <BadgeGrid label="Your badges" badges={badges} onOpenBadge={onOpenBadge} />
        </Card>

        <Card title="Level ladder" className={styles.wide}>
          <LevelLadder currentLevel={employee.level} thresholds={xp.thresholds} />
        </Card>

        <Card title="Final assessment" className={styles.wide}>
          <div className={styles.finalBody}>
            {finalAssessment.status === 'locked' ? (
              <p className={styles.finalLocked}>
                <Lock aria-hidden="true" size={16} />
                {finalAssessment.lockedReason ?? `Unlocks after all ${total} modules`}
              </p>
            ) : finalAssessment.status === 'completed' ? (
              <p>
                Completed
                {finalAssessment.scorePercent !== undefined &&
                  ` with ${finalAssessment.scorePercent}%`}
                .
              </p>
            ) : (
              <p>
                {finalAssessment.questionCount !== undefined
                  ? `${finalAssessment.questionCount} questions covering every module.`
                  : 'Questions covering every module.'}
              </p>
            )}
            <Button
              variant="secondary"
              iconEnd={ArrowRight}
              softDisabled={finalAssessment.status === 'locked'}
              onClick={onStartFinalAssessment}
            >
              {finalAssessment.status === 'completed' ? 'View result' : 'Start final assessment'}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <AppShell
      navItems={NAV}
      currentNavId="dashboard"
      onNavigate={onNavigate}
      user={{ name: employee.name, roleLabel: 'Employee' }}
      onOpenSettings={onOpenSettings}
      onSignOut={onSignOut}
      title={firstTime ? `Welcome, ${firstName}` : `Good to see you, ${firstName}`}
    >
      {content}
    </AppShell>
  );
}
