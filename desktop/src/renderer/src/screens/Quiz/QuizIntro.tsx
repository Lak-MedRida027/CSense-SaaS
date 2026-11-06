import { useId } from 'react';
import { Button } from '../../components/Button';
import { ArrowLeft, ClipboardCheck, Lock, ShieldCheck } from '../../icons';
import type { QuizScreenProps } from './Quiz.types';
import styles from './Quiz.module.css';

type QuizIntroProps = Pick<
  QuizScreenProps,
  | 'title'
  | 'questions'
  | 'passMarkPercent'
  | 'attemptNumber'
  | 'onRequestStartLockdown'
  | 'onBackToModule'
>;

/** Plain-language explanation of secure mode before lockdown starts. */
export function QuizIntro({
  title,
  questions,
  passMarkPercent,
  attemptNumber,
  onRequestStartLockdown,
  onBackToModule,
}: QuizIntroProps) {
  const headingId = useId();
  return (
    <main className={styles.introPage}>
      <section className={styles.introCard} aria-labelledby={headingId}>
        <p className={styles.eyebrow}>{title}</p>
        <h1 id={headingId} className={styles.introHeading}>
          Ready for the quiz?
        </h1>
        <ul className={styles.facts}>
          <li>
            <ClipboardCheck aria-hidden="true" size={20} />
            {questions.length} questions · {passMarkPercent}% to pass
            {attemptNumber !== undefined && attemptNumber > 1 && ` · attempt ${attemptNumber}`}
          </li>
          <li>
            <ShieldCheck aria-hidden="true" size={20} />
            You can review your answers before submitting.
          </li>
        </ul>
        <div className={styles.secureNote} data-tone="info">
          <Lock aria-hidden="true" size={20} />
          <div>
            <p className={styles.secureTitle}>The quiz runs in secure mode</p>
            <p>
              While the quiz is open you can&apos;t copy, paste, switch apps or use keyboard
              shortcuts. Secure mode ends when you submit, or if you choose Exit quiz.
            </p>
          </div>
        </div>
        <div className={styles.introActions}>
          {onBackToModule && (
            <Button variant="ghost" iconStart={ArrowLeft} onClick={onBackToModule}>
              Back to module
            </Button>
          )}
          <Button size="lg" iconStart={Lock} onClick={onRequestStartLockdown}>
            Start secure quiz
          </Button>
        </div>
      </section>
    </main>
  );
}
