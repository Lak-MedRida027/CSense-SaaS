import { useId } from 'react';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { QuizQuestion } from '../../components/QuizQuestion';
import { ArrowLeft, CircleCheck, TriangleAlert } from '../../icons';
import type { QuizScreenProps } from './Quiz.types';
import styles from './Quiz.module.css';

type ConfirmSubmitProps = Pick<
  QuizScreenProps,
  'questions' | 'answers' | 'submitting' | 'onNavigate' | 'onBackToQuestions' | 'onSubmit'
>;

/** Pre-submit check (inside lockdown): what is answered, what is not, then submit. */
export function QuizConfirmSubmit({
  questions,
  answers,
  submitting = false,
  onNavigate,
  onBackToQuestions,
  onSubmit,
}: ConfirmSubmitProps) {
  const headingId = useId();
  const unanswered = questions.filter((q) => !answers[q.id]).length;
  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <h1 id={headingId} className={styles.panelHeading}>
        Review before submitting
      </h1>
      <p className={styles.muted}>
        You answered {questions.length - unanswered} of {questions.length} questions.
      </p>
      {unanswered > 0 && (
        <Alert tone="caution" title={`${unanswered} unanswered`} announce={false}>
          Unanswered questions count as incorrect. Select a question to go back to it.
        </Alert>
      )}
      <ol className={styles.reviewList}>
        {questions.map((q, i) => {
          const answered = Boolean(answers[q.id]);
          return (
            <li key={q.id}>
              <button
                type="button"
                className={styles.reviewItem}
                onClick={() => {
                  onNavigate(i);
                }}
              >
                <span className={styles.reviewNum}>{i + 1}</span>
                <span className={styles.reviewStem}>{q.stem}</span>
                <span className={styles.reviewState} data-tone={answered ? 'success' : 'caution'}>
                  {answered ? (
                    <CircleCheck aria-hidden="true" size={16} />
                  ) : (
                    <TriangleAlert aria-hidden="true" size={16} />
                  )}
                  {answered ? 'Answered' : 'Unanswered'}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className={styles.runnerActions}>
        <Button variant="secondary" iconStart={ArrowLeft} onClick={onBackToQuestions}>
          Back to questions
        </Button>
        <Button loading={submitting} onClick={onSubmit}>
          Submit answers
        </Button>
      </div>
    </section>
  );
}

type AnswerReviewProps = Pick<
  QuizScreenProps,
  'title' | 'questions' | 'answers' | 'onBackToResult'
>;

/** Post-result review: every question with "Your answer" / "Correct answer" and explanations. */
export function QuizAnswerReview({ title, questions, answers, onBackToResult }: AnswerReviewProps) {
  const headingId = useId();
  return (
    <main className={styles.reviewPage} aria-labelledby={headingId}>
      <header className={styles.reviewHeader}>
        <Button variant="ghost" iconStart={ArrowLeft} onClick={onBackToResult}>
          Back to results
        </Button>
        <p className={styles.eyebrow}>{title}</p>
        <h1 id={headingId} className={styles.panelHeading}>
          Answer review
        </h1>
      </header>
      <ol className={styles.answerList}>
        {questions.map((q, i) => (
          <li key={q.id} className={styles.answerItem}>
            <QuizQuestion
              questionNumber={i + 1}
              totalQuestions={questions.length}
              stem={q.stem}
              options={q.options}
              selectedOptionId={answers[q.id] ?? null}
              onSelect={() => undefined}
              mode="review"
              correctOptionId={q.correctOptionId}
              explanation={q.explanation}
            />
          </li>
        ))}
      </ol>
    </main>
  );
}
