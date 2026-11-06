import { useId, useState } from 'react';
import { Button } from '../../components/Button';
import { InteractiveExercise } from '../../components/InteractiveExercise';
import { ModuleList } from '../../components/ModuleList';
import { Stepper, type StepItem } from '../../components/Stepper';
import { TranscriptPanel } from '../../components/TranscriptPanel';
import { VideoPlayerFrame } from '../../components/VideoPlayerFrame';
import { ArrowLeft, ArrowRight, Clock, MousePointerClick, Play } from '../../icons';
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
 * Module player with the sequential-lock sidebar. Video variant: player + captions + transcript +
 * key takeaways. Interactive variant: scenario exercise with immediate feedback.
 */
export function ModulePlayerScreen({
  module,
  totalModules,
  modules,
  finalAssessment,
  stage,
  video,
  exercise,
  keyTakeaways,
  canStartQuiz,
  quizLockedReason,
  onSelectModule,
  onStartQuiz,
  onContinueToPractice,
  onVideoProgress,
  onVideoEnded,
  onExerciseAnswer,
  onExerciseNext,
  onBackToDashboard,
}: ModulePlayerScreenProps) {
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const headingId = useId();
  const reasonId = useId();
  const showVideo = module.format === 'video' && stage === 'lesson' && video;
  const showExercise = exercise && (module.format === 'interactive' || stage === 'practice');
  const FormatIcon = module.format === 'video' ? Play : MousePointerClick;

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
          currentId={module.id}
          onSelect={onSelectModule}
          finalAssessment={finalAssessment}
        />
      </aside>
      <main id="module-content" tabIndex={-1} className={styles.main} aria-labelledby={headingId}>
        <header className={styles.header}>
          <div className={styles.titleRow}>
            <div>
              <p className={styles.eyebrow}>
                Module {module.order} of {totalModules}
              </p>
              <h1 id={headingId} className={styles.title}>
                {module.title}
              </h1>
            </div>
            <p className={styles.meta}>
              <FormatIcon aria-hidden="true" size={16} />
              {module.format === 'video' ? 'Video' : 'Interactive'}
              <Clock aria-hidden="true" size={16} />
              About {module.durationMinutes} min
            </p>
          </div>
          <Stepper label="Module progress" steps={stageSteps(stage)} />
        </header>

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
              transcriptOpen={transcriptOpen}
              onToggleTranscript={() => {
                setTranscriptOpen((o) => !o);
              }}
            />
            {transcriptOpen && <TranscriptPanel cues={video.transcript} />}
          </div>
        )}

        {showExercise && (
          <section className={styles.card} aria-label="Practice">
            <InteractiveExercise
              {...exercise}
              onAnswer={onExerciseAnswer ?? (() => undefined)}
              onNext={onExerciseNext ?? (() => undefined)}
            />
          </section>
        )}

        {keyTakeaways && keyTakeaways.length > 0 && stage === 'lesson' && (
          <details className={styles.takeaways}>
            <summary className={styles.summary}>Key takeaways</summary>
            <ul className={styles.takeawayList}>
              {keyTakeaways.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </details>
        )}

        <footer className={styles.footer}>
          {!canStartQuiz && quizLockedReason && (
            <p id={reasonId} className={styles.reason}>
              {quizLockedReason}
            </p>
          )}
          {module.format === 'video' && stage === 'lesson' && onContinueToPractice ? (
            <Button iconEnd={ArrowRight} onClick={onContinueToPractice}>
              Continue to practice
            </Button>
          ) : (
            <Button
              iconEnd={ArrowRight}
              softDisabled={!canStartQuiz}
              aria-describedby={!canStartQuiz && quizLockedReason ? reasonId : undefined}
              onClick={onStartQuiz}
            >
              Continue to quiz
            </Button>
          )}
        </footer>
      </main>
    </div>
  );
}
