import { useId, type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { ErrorState } from '../ErrorState';
import { FeedbackPanel } from '../FeedbackPanel';
import { QuizOption } from '../QuizOption';
import { SkeletonText } from '../Skeleton';
import styles from './QuizQuestion.module.css';

export interface QuizQuestionOption {
  id: string;
  text: ReactNode;
}

export interface QuizQuestionProps {
  questionNumber: number;
  totalQuestions: number;
  stem: ReactNode;
  options: readonly QuizQuestionOption[];
  selectedOptionId: string | null;
  onSelect: (optionId: string) => void;
  /** `review` shows the correct answer and explanation (answers are not editable). */
  mode?: 'answer' | 'review' | undefined;
  correctOptionId?: string | undefined;
  explanation?: ReactNode | undefined;
  state?: 'ready' | 'loading' | 'error' | undefined;
  onRetry?: (() => void) | undefined;
  className?: string | undefined;
}

const LETTERS = 'ABCDEFGHIJ';

/** One question: heading "Question n of N", the stem as the fieldset legend, radio options. */
export function QuizQuestion({
  questionNumber,
  totalQuestions,
  stem,
  options,
  selectedOptionId,
  onSelect,
  mode = 'answer',
  correctOptionId,
  explanation,
  state = 'ready',
  onRetry,
  className,
}: QuizQuestionProps) {
  const name = useId();
  if (state === 'loading') {
    return (
      <div aria-busy="true" className={className}>
        <SkeletonText lines={5} />
        <span className="sr-only">Loading question</span>
      </div>
    );
  }
  if (state === 'error') {
    return <ErrorState description="This question could not be loaded." onRetry={onRetry} />;
  }

  const review = mode === 'review';
  return (
    <div className={cx(styles.root, className)}>
      <h2 className={styles.counter}>
        Question {questionNumber} of {totalQuestions}
      </h2>
      <fieldset className={styles.fieldset}>
        <legend className={styles.stem}>{stem}</legend>
        <div className={styles.options}>
          {options.map((opt, i) => (
            <QuizOption
              key={opt.id}
              name={name}
              optionId={opt.id}
              letter={LETTERS[i] ?? String(i + 1)}
              label={opt.text}
              checked={selectedOptionId === opt.id}
              onSelect={onSelect}
              review={
                review
                  ? {
                      isCorrect: opt.id === correctOptionId,
                      isSelected: opt.id === selectedOptionId,
                    }
                  : undefined
              }
            />
          ))}
        </div>
      </fieldset>
      {review && selectedOptionId === null && (
        <p className={styles.unanswered}>You did not answer this question.</p>
      )}
      {review && explanation && (
        <FeedbackPanel
          correct={selectedOptionId !== null && selectedOptionId === correctOptionId}
          explanation={explanation}
          focusOnMount={false}
        />
      )}
    </div>
  );
}
