import { useId, useState } from 'react';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { InteractiveExercise } from '../../components/InteractiveExercise';
import { LessonText } from '../../components/LessonText';
import { ModuleList } from '../../components/ModuleList';
import { Spinner } from '../../components/Spinner';
import { Stepper, type StepItem } from '../../components/Stepper';
import { TranscriptPanel } from '../../components/TranscriptPanel';
import { VideoPlayerFrame } from '../../components/VideoPlayerFrame';
import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  Clock,
  Lock,
  MousePointerClick,
  Play,
} from '../../icons';
import type { ModulePlayerScreenProps, ModuleStage } from './ModulePlayer.types';
import styles from './ModulePlayer.module.css';

const STAGES: readonly { id: ModuleStage; label: string }[] = [
  { id: 'lesson', label: 'Lesson' },
  { id: 'practice', label: 'Practice' },
  { id: 'quiz', label: 'Quiz' },
];

function stageSteps(stage: ModuleStage): StepItem[] {
  const idx = STAGES.findIndex((s) => s.id === stage);
  return STAGES.map((s, i) => ({
    id: s.id,
    label: s.label,
    status: i < idx ? 'complete' : i === idx ? 'current' : 'upcoming',
  }));
}

/**
 * Module player with the sequential-lock sidebar. Lesson stage: video (video modules) with captions
 * and transcript, the lesson text and key takeaways. Practice stage: one scenario at a time with
 * immediate feedback. Loading, error, locked and not-found states keep the sidebar so the learner is
 * never stranded.
 */
export function ModulePlayerScreen({
  module,
  totalModules,
  modules,
  finalAssessment,
  state = 'ready',
  lockedReason,
  notice,
  onRetry,
  stage,
  lessonBody,
  video,
  exercise,
  keyTakeaways,
  lessonAction,
  quizSummary,
  onSelectModule,
  onLessonAction,
  onStartQuiz,
  onVideoProgress,
  onVideoEnded,
  onVideoError,
  onTranscriptReachedEnd,
  onExerciseAnswer,
  onExerciseNext,
  onSelectStage,
  onBackToDashboard,
}: ModulePlayerScreenProps) {
  const [transcriptToggled, setTranscriptToggled] = useState(false);
  const headingId = useId();
  const reasonId = useId();
  const videoUnavailable = video?.state === 'error' || video?.state === 'empty';
  // An unavailable video makes the transcript the lesson, so it opens by itself.
  const transcriptOpen = transcriptToggled || videoUnavailable;
  const ready = state === 'ready' && module !== undefined;
  const showVideo = ready && module.format === 'video' && stage === 'lesson' && video;
  const FormatIcon = module?.format === 'video' ? Play : MousePointerClick;

  let body;
  if (state === 'loading' || (state === 'ready' && !module)) {
    body = (
      <div className={styles.stateBox} aria-busy="true">
        <Spinner size="lg" label="Loading the module" />
      </div>
    );
  } else if (state === 'error') {
    body = (
      <div className={styles.stateBox}>
        <ErrorState description="This module could not be loaded." onRetry={onRetry} />
      </div>
    );
  } else if (state === 'locked') {
    body = (
      <div className={styles.stateBox}>
        <EmptyState
          icon={Lock}
          title="This module is locked"
          description={lockedReason ?? 'Pass the previous quiz to unlock it.'}
          action={
            <Button variant="secondary" iconStart={ArrowLeft} onClick={onBackToDashboard}>
              Back to dashboard
            </Button>
          }
        />
      </div>
    );
  } else if (state === 'not_found') {
    body = (
      <div className={styles.stateBox}>
        <EmptyState
          title="This module is no longer available"
          description="Your security team may have changed the training."
          action={
            <Button variant="secondary" iconStart={ArrowLeft} onClick={onBackToDashboard}>
              Back to dashboard
            </Button>
          }
        />
      </div>
    );
  } else if (module) {
    body = (
      <>
        {notice && <Alert tone={notice.tone} title={notice.text} />}

        {stage === 'lesson' && (
          <>
            {showVideo && (
              <div className={transcriptOpen ? styles.videoWithTranscript : styles.videoOnly}>
                <VideoPlayerFrame
                  title={module.title}
                  src={video.src}
                  captionsSrc={video.captionsSrc}
                  poster={video.poster}
                  state={video.state}
                  onProgress={onVideoProgress}
                  onEnded={onVideoEnded}
                  onError={onVideoError}
                  transcriptOpen={transcriptOpen}
                  onToggleTranscript={() => {
                    setTranscriptToggled((o) => !o);
                  }}
                />
                {transcriptOpen && (
                  <TranscriptPanel cues={video.transcript} onReachedEnd={onTranscriptReachedEnd} />
                )}
              </div>
            )}
            {lessonBody && (
              <section className={styles.card} aria-label="Lesson">
                <LessonText text={lessonBody} />
              </section>
            )}
          </>
        )}

        {stage === 'practice' && exercise && (
          <section className={styles.card} aria-label="Practice">
            <InteractiveExercise
              {...exercise}
              onAnswer={onExerciseAnswer ?? (() => undefined)}
              onNext={onExerciseNext ?? (() => undefined)}
            />
          </section>
        )}

        {stage === 'quiz' && (
          <section className={styles.card} aria-label="Quiz">
            {quizSummary?.passed ? (
              <div className={styles.summary}>
                <p className={styles.summaryLine}>
                  <CircleCheck aria-hidden="true" size={20} />
                  {quizSummary.bestScore !== null
                    ? `Passed with ${String(quizSummary.bestScore)}%`
                    : 'Passed'}
                </p>
                <p className={styles.reason}>
                  {quizSummary.attempts} attempt{quizSummary.attempts === 1 ? '' : 's'}. You can
                  read the lesson again at any time.
                </p>
                <div className={styles.summaryActions}>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      onSelectStage?.('lesson');
                    }}
                  >
                    Review the lesson
                  </Button>
                  <Button iconEnd={ArrowRight} onClick={onBackToDashboard}>
                    Back to dashboard
                  </Button>
                </div>
              </div>
            ) : (
              <div className={styles.summary}>
                <p className={styles.summaryLine}>
                  {quizSummary && quizSummary.attempts > 0
                    ? 'Not passed yet'
                    : 'The quiz is ready when you are'}
                </p>
                {quizSummary && quizSummary.attempts > 0 && (
                  <p className={styles.reason}>
                    {quizSummary.bestScore !== null
                      ? `Best score ${String(quizSummary.bestScore)}% after `
                      : ''}
                    {quizSummary.attempts} attempt{quizSummary.attempts === 1 ? '' : 's'}. Review
                    the lesson, then try again.
                  </p>
                )}
                {quizSummary?.blockedReason && (
                  <p className={styles.reason}>{quizSummary.blockedReason}</p>
                )}
                <div className={styles.summaryActions}>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      onSelectStage?.('lesson');
                    }}
                  >
                    Review the lesson
                  </Button>
                  <Button
                    iconEnd={ArrowRight}
                    softDisabled={quizSummary?.blockedReason !== undefined}
                    onClick={onStartQuiz}
                  >
                    {quizSummary && quizSummary.attempts > 0 ? 'Retry quiz' : 'Take the quiz'}
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}

        {keyTakeaways && keyTakeaways.length > 0 && stage === 'lesson' && (
          <details className={styles.takeaways}>
            <summary className={styles.summaryToggle}>Key takeaways</summary>
            <ul className={styles.takeawayList}>
              {keyTakeaways.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </details>
        )}

        {stage === 'lesson' && lessonAction && (
          <footer className={styles.footer}>
            {!lessonAction.enabled && lessonAction.reason && (
              <p id={reasonId} className={styles.reason}>
                {lessonAction.reason}
              </p>
            )}
            <Button
              iconEnd={ArrowRight}
              loading={lessonAction.busy}
              softDisabled={!lessonAction.enabled}
              aria-describedby={!lessonAction.enabled && lessonAction.reason ? reasonId : undefined}
              onClick={onLessonAction}
            >
              {lessonAction.label}
            </Button>
          </footer>
        )}
      </>
    );
  }

  return (
    <div className={styles.shell}>
      <a href="#module-content" className={styles.skip}>
        Skip to lesson
      </a>
      <aside className={styles.sidebar}>
        <Button variant="ghost" size="sm" iconStart={ArrowLeft} onClick={onBackToDashboard}>
          Dashboard
        </Button>
        <p className={styles.sideHeading}>Modules</p>
        <ModuleList
          modules={modules}
          currentId={module?.id}
          onSelect={onSelectModule}
          finalAssessment={finalAssessment}
          loading={modules.length === 0 && state === 'loading'}
        />
      </aside>
      <main id="module-content" tabIndex={-1} className={styles.main} aria-labelledby={headingId}>
        <header className={styles.header}>
          <div className={styles.titleRow}>
            <div>
              {module && (
                <p className={styles.eyebrow}>
                  Module {module.order} of {totalModules}
                </p>
              )}
              <h1 id={headingId} className={styles.title}>
                {module?.title ?? 'Module'}
              </h1>
            </div>
            {module && (
              <p className={styles.meta}>
                <FormatIcon aria-hidden="true" size={16} />
                {module.format === 'video' ? 'Video' : 'Interactive'}
                <Clock aria-hidden="true" size={16} />
                About {module.durationMinutes} min
              </p>
            )}
          </div>
          {ready && <Stepper label="Module progress" steps={stageSteps(stage)} />}
        </header>
        {body}
      </main>
    </div>
  );
}
