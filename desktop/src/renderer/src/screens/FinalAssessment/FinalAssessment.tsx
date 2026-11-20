import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Spinner } from '../../components/Spinner';
import { ArrowRight, CircleCheck, ClipboardCheck, GraduationCap, Lock } from '../../icons';
import { AppShell } from '../../layouts/AppShell';
import { EMPLOYEE_NAV } from '../employeeNav';
import type { FinalAssessmentScreenProps } from './FinalAssessment.types';
import styles from '../employeePage.module.css';

/** Final assessment entry: locked, available (with cooldown), or completed. No retake after a pass. */
export function FinalAssessmentScreen({
  employee,
  final,
  state = 'ready',
  errorDescription,
  notice,
  starting = false,
  onRetry,
  onStart,
  onBackToDashboard,
  onNavigate,
  onOpenSettings,
  onSignOut,
}: FinalAssessmentScreenProps) {
  let content;
  if (state === 'loading') {
    content = (
      <div className={styles.loading} aria-busy="true">
        <Spinner size="lg" label="Loading the final assessment" />
      </div>
    );
  } else if (state === 'error') {
    content = (
      <ErrorState
        description={errorDescription ?? 'The final assessment could not be loaded.'}
        onRetry={onRetry}
      />
    );
  } else if (state === 'empty' || !final) {
    content = (
      <EmptyState
        icon={GraduationCap}
        title="No final assessment is configured yet"
        description="Your security team will add it."
      />
    );
  } else if (final.status === 'locked') {
    content = (
      <Card title={final.title}>
        <div className={styles.stack}>
          <p className={styles.row}>
            <Lock aria-hidden="true" size={18} />
            {final.lockedReason ?? 'Complete every module to unlock the final assessment.'}
          </p>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={onBackToDashboard}>
              Back to dashboard
            </Button>
          </div>
        </div>
      </Card>
    );
  } else if (final.status === 'completed') {
    content = (
      <Card title={final.title}>
        <div className={styles.stack}>
          <p className={styles.lead}>
            <CircleCheck aria-hidden="true" size={20} /> Training complete
          </p>
          <p>
            Completed
            {final.scorePercent !== undefined && ` with ${String(final.scorePercent)}%`}
            {final.completedOn && ` on ${final.completedOn}`}.
          </p>
          <div className={styles.actions}>
            <Button iconEnd={ArrowRight} onClick={onBackToDashboard}>
              Back to dashboard
            </Button>
          </div>
        </div>
      </Card>
    );
  } else {
    content = (
      <Card title={final.title}>
        <div className={styles.stack}>
          <ul className={styles.facts}>
            <li className={styles.row}>
              <ClipboardCheck aria-hidden="true" size={18} />
              {final.questionCount} questions covering every module
            </li>
            <li className={styles.row}>
              <CircleCheck aria-hidden="true" size={18} />
              {final.passMarkPercent}% to pass
              {final.attemptNumber > 1 && ` · attempt ${String(final.attemptNumber)}`}
            </li>
          </ul>
          {final.startBlocked && (
            <Alert tone="info" title={final.startBlocked.reason} announce={false} />
          )}
          <div className={styles.actions}>
            <Button
              size="lg"
              iconEnd={ArrowRight}
              loading={starting}
              softDisabled={final.startBlocked !== undefined}
              onClick={onStart}
            >
              Start final assessment
            </Button>
          </div>
        </div>
      </Card>
    );
  }
  return (
    <AppShell
      navItems={EMPLOYEE_NAV}
      currentNavId="final"
      onNavigate={onNavigate}
      user={{ name: employee.name, roleLabel: 'Employee' }}
      onOpenSettings={onOpenSettings}
      onSignOut={onSignOut}
      title="Final assessment"
    >
      <div className={styles.stack}>
        {notice && <Alert tone={notice.tone} title={notice.text} announce={false} />}
        {content}
      </div>
    </AppShell>
  );
}
