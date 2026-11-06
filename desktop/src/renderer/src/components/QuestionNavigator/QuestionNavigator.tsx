import { Flag } from '../../icons';
import { cx } from '../../lib/cx';
import styles from './QuestionNavigator.module.css';

export interface NavigatorQuestion {
  id: string;
  answered: boolean;
  /** Marked for review by the user. */
  flagged?: boolean | undefined;
}

export interface QuestionNavigatorProps {
  questions: readonly NavigatorQuestion[];
  /** Zero-based index of the question on screen. */
  currentIndex: number;
  /** Seam: jump to a question. */
  onJump: (index: number) => void;
  className?: string | undefined;
}

/** Grid of 44px buttons for long assessments; state is in each button's accessible name. */
export function QuestionNavigator({
  questions,
  currentIndex,
  onJump,
  className,
}: QuestionNavigatorProps) {
  const answered = questions.filter((q) => q.answered).length;
  return (
    <nav aria-label="Questions" className={cx(styles.root, className)}>
      <p className={styles.summary}>
        {answered} of {questions.length} answered
      </p>
      <ol className={styles.grid}>
        {questions.map((q, i) => {
          const parts = [`Question ${i + 1}`, q.answered ? 'answered' : 'unanswered'];
          if (q.flagged) parts.push('flagged for review');
          return (
            <li key={q.id}>
              <button
                type="button"
                aria-label={parts.join(', ')}
                aria-current={i === currentIndex ? 'step' : undefined}
                className={cx(
                  styles.cell,
                  q.answered && styles.answered,
                  i === currentIndex && styles.current,
                )}
                onClick={() => {
                  onJump(i);
                }}
              >
                {i + 1}
                {q.flagged && <Flag aria-hidden="true" size={10} className={styles.flag} />}
              </button>
            </li>
          );
        })}
      </ol>
      <ul className={styles.legend} aria-hidden="true">
        <li>
          <span className={cx(styles.swatch, styles.answered)} /> Answered
        </li>
        <li>
          <span className={styles.swatch} /> Unanswered
        </li>
      </ul>
    </nav>
  );
}
