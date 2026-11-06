import { Button } from '../../components/Button';
import { ProgressBar } from '../../components/ProgressBar';
import { QuestionNavigator } from '../../components/QuestionNavigator';
import { QuizQuestion } from '../../components/QuizQuestion';
import { ArrowLeft, ArrowRight, ListChecks } from '../../icons';
import type { QuizScreenProps } from './Quiz.types';
import styles from './Quiz.module.css';

type QuizRunnerProps = Pick<
  QuizScreenProps,
  | 'kind'
  | 'title'
  | 'questions'
  | 'answers'
  | 'currentIndex'
  | 'onAnswer'
  | 'onNavigate'
  | 'onRequestSubmitReview'
>;

/** Question-by-question runner (inside lockdown). The final assessment adds a navigator grid. */
export function QuizRunner({
  kind,
  title,
  questions,
  answers,
  currentIndex,
  onAnswer,
  onNavigate,
  onRequestSubmitReview,
}: QuizRunnerProps) {
  const q = questions[currentIndex];
  const total = questions.length;
  const isLast = currentIndex === total - 1;
  const answeredCount = questions.filter((x) => answers[x.id]).length;

  return (
    <div className={kind === 'final' ? styles.runnerWithNav : styles.runner}>
      <div className={styles.runnerMain}>
        <header className={styles.runnerHeader}>
          <h1 className={styles.eyebrow}>{title}</h1>
          <ProgressBar
            label="Quiz progress"
            hideLabel
            value={answeredCount}
            max={total}
            valueText={`${answeredCount} of ${total} answered`}
            tone="neutral"
            size="sm"
          />
        </header>
        {q && (
          <QuizQuestion
            key={q.id}
            questionNumber={currentIndex + 1}
            totalQuestions={total}
            stem={q.stem}
            options={q.options}
            selectedOptionId={answers[q.id] ?? null}
            onSelect={(optionId) => {
              onAnswer(q.id, optionId);
            }}
          />
        )}
        <div className={styles.runnerActions}>
          <Button
            variant="secondary"
            iconStart={ArrowLeft}
            disabled={currentIndex === 0}
            onClick={() => {
              onNavigate(currentIndex - 1);
            }}
          >
            Back
          </Button>
          {isLast ? (
            <Button iconStart={ListChecks} onClick={onRequestSubmitReview}>
              Review and submit
            </Button>
          ) : (
            <Button
              iconEnd={ArrowRight}
              onClick={() => {
                onNavigate(currentIndex + 1);
              }}
            >
              Next question
            </Button>
          )}
        </div>
      </div>
      {kind === 'final' && (
        <aside className={styles.navigator}>
          <QuestionNavigator
            questions={questions.map((x) => ({ id: x.id, answered: Boolean(answers[x.id]) }))}
            currentIndex={currentIndex}
            onJump={onNavigate}
          />
        </aside>
      )}
    </div>
  );
}
