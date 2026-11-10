import { LEVELS, type Level, type ProgressStatus } from '@csense/shared';
import { useId } from 'react';
import { Alert } from '../../components/Alert';
import { BrandLogo } from '../../components/BrandLogo';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { LevelChip } from '../../components/LevelChip';
import { Lock, LogOut, Play } from '../../icons';
import type { TrainingHomeProps } from './TrainingHome.types';
import styles from './TrainingHome.module.css';

const STATUS_TEXT: Record<ProgressStatus, string> = {
  locked: 'Locked',
  unlocked: 'Ready to start',
  in_progress: 'In progress',
  completed: 'Completed',
};

const isLevel = (v: string | undefined): v is Level => LEVELS.some((l) => l === v);

/**
 * Phase 5 minimal landing page after the gate releases the workstation. Temporary: Phase 6 replaces
 * it with the employee dashboard and module player. It exists so the gate and quiz lockdown have
 * somewhere to land and be tested end to end.
 */
export function TrainingHomeScreen({
  userName,
  role,
  level,
  state,
  modules,
  finalTest,
  notice,
  onStartQuiz,
  onStartFinal,
  onRetry,
  onSignOut,
  appVersion,
}: TrainingHomeProps) {
  const headingId = useId();
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <BrandLogo variant="wordmark" height={32} />
        <div className={styles.user}>
          <span className={styles.name}>{userName}</span>
          {isLevel(level) && <LevelChip level={level} size="sm" />}
          <Button variant="ghost" size="sm" iconStart={LogOut} onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </header>
      <main className={styles.main} aria-labelledby={headingId}>
        <h1 id={headingId} className={styles.heading}>
          {role === 'administrator' ? 'Welcome' : 'Your training'}
        </h1>
        {notice && <Alert tone={notice.tone} title={notice.text} announce={false} />}
        {role === 'administrator' ? (
          <Alert tone="info" title="Admin console arrives in a later release" announce={false}>
            Your administrator account is signed in. Management tools are not part of this version.
          </Alert>
        ) : (
          <Card
            title="Modules"
            state={state === 'ready' ? (modules.length === 0 ? 'empty' : 'ready') : state}
            emptyTitle="No modules yet"
            emptyDescription="Your administrator has not published any training."
            errorMessage="Your training could not be loaded."
            onRetry={onRetry}
          >
            <ol className={styles.list}>
              {modules.map((m) => (
                <li key={m.id} className={styles.item} data-status={m.status}>
                  <div className={styles.itemText}>
                    <p className={styles.itemTitle}>
                      <span className={styles.order}>Module {m.order}</span> {m.title}
                    </p>
                    <p className={styles.itemMeta}>
                      {m.status === 'locked' && <Lock aria-hidden="true" size={14} />}
                      {STATUS_TEXT[m.status]}
                      {m.lockedReason ? ` · ${m.lockedReason}` : ''}
                      {typeof m.bestScore === 'number'
                        ? ` · best score ${String(m.bestScore)}%`
                        : ''}
                    </p>
                    {m.quizNote && <p className={styles.itemNote}>{m.quizNote}</p>}
                  </div>
                  {m.quizAvailable && (
                    <Button
                      size="sm"
                      iconStart={Play}
                      onClick={() => {
                        onStartQuiz(m.id);
                      }}
                    >
                      <span className="sr-only">Module {m.order}: </span>Start quiz
                    </Button>
                  )}
                </li>
              ))}
              {finalTest && (
                <li className={styles.item} data-status={finalTest.status}>
                  <div className={styles.itemText}>
                    <p className={styles.itemTitle}>{finalTest.title}</p>
                    <p className={styles.itemMeta}>
                      {finalTest.status === 'locked' && <Lock aria-hidden="true" size={14} />}
                      {STATUS_TEXT[finalTest.status]}
                    </p>
                    {finalTest.note && <p className={styles.itemNote}>{finalTest.note}</p>}
                  </div>
                  {finalTest.available && (
                    <Button size="sm" iconStart={Play} onClick={onStartFinal}>
                      Start final assessment
                    </Button>
                  )}
                </li>
              )}
            </ol>
          </Card>
        )}
      </main>
      {appVersion && <footer className={styles.footer}>v{appVersion}</footer>}
    </div>
  );
}
