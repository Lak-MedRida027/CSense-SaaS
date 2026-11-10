import { ScoreSummary } from '../../components/ScoreSummary';
import type { QuizScreenProps } from './Quiz.types';
import styles from './Quiz.module.css';

type QuizResultProps = Pick<
  QuizScreenProps,
  | 'title'
  | 'result'
  | 'passMarkPercent'
  | 'continueLabel'
  | 'onReviewAnswers'
  | 'onRetry'
  | 'onContinue'
  | 'onBackToModule'
>;

/** Result page (lockdown has exited). Pass/fail and the pass mark come from props. */
export function QuizResult({
  title,
  result,
  passMarkPercent,
  continueLabel,
  onReviewAnswers,
  onRetry,
  onContinue,
  onBackToModule,
}: QuizResultProps) {
  return (
    <main className={styles.resultPage}>
      <div className={styles.resultCard}>
        {result ? (
          <ScoreSummary
            title={title}
            scorePercent={result.scorePercent}
            passMarkPercent={passMarkPercent}
            passed={result.passed}
            correctCount={result.correctCount}
            totalCount={result.totalCount}
            xpEarned={result.xpEarned}
            badge={result.badge}
            onReview={onReviewAnswers}
            onRetry={onRetry}
            onContinue={onContinue}
            continueLabel={continueLabel}
            onBack={onBackToModule}
          />
        ) : (
          <ScoreSummary
            title={title}
            loading
            scorePercent={0}
            passMarkPercent={passMarkPercent}
            passed={false}
            correctCount={0}
            totalCount={0}
          />
        )}
      </div>
    </main>
  );
}
