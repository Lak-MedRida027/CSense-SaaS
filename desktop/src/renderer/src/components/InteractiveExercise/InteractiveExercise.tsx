import { useId, type ReactNode } from 'react';
import { ArrowRight } from '../../icons';
import { cx } from '../../lib/cx';
import { Button } from '../Button';
import { FeedbackPanel } from '../FeedbackPanel';
import { QuizOption } from '../QuizOption';
import styles from './InteractiveExercise.module.css';

export interface ExerciseChoice {
  id: string;
  text: ReactNode;
}

export interface ExerciseFeedback {
  correct: boolean;
  explanation: ReactNode;
  /** Overrides the default "Correct" / "Incorrect" heading, e.g. "Not quite". */
  title?: string | undefined;
}

export interface InteractiveExerciseProps {
  /** e.g. 2 of 4. */
  scenarioNumber: number;
  totalScenarios: number;
  /** Scenario text, e.g. the suspicious SMS. */
  prompt: ReactNode;
  /** Optional visual mock (email/SMS) rendered above the choices. */
  artifact?: ReactNode | undefined;
  choices: readonly ExerciseChoice[];
  selectedChoiceId: string | null;
  /** The right answer, known once the server has graded this exercise: tagged "Correct answer". */
  correctChoiceId?: string | undefined;
  /** An answer is being saved: choices are disabled and the region is busy. */
  pending?: boolean | undefined;
  /**
   * Feedback from the engine once the user answers. When present, choices lock and the
   * explanation is shown immediately (focus moves to it).
   */
  feedback?: ExerciseFeedback | undefined;
  /** Seam: user picked a choice. */
  onAnswer: (choiceId: string) => void;
  /** Seam: continue to the next scenario / step. */
  onNext: () => void;
  nextLabel?: string | undefined;
  className?: string | undefined;
}

const LETTERS = 'ABCDEFGHIJ';

export function InteractiveExercise({
  scenarioNumber,
  totalScenarios,
  prompt,
  artifact,
  choices,
  selectedChoiceId,
  correctChoiceId,
  pending = false,
  feedback,
  onAnswer,
  onNext,
  nextLabel = 'Next scenario',
  className,
}: InteractiveExerciseProps) {
  const name = useId();
  const answered = feedback !== undefined;
  return (
    <div className={cx(styles.root, className)} aria-busy={pending || undefined}>
      <p className={styles.counter}>
        Scenario {scenarioNumber} of {totalScenarios}
      </p>
      {artifact && <div className={styles.artifact}>{artifact}</div>}
      <fieldset className={styles.fieldset}>
        <legend className={styles.prompt}>{prompt}</legend>
        <div className={styles.choices}>
          {choices.map((c, i) => (
            <QuizOption
              key={c.id}
              name={name}
              optionId={c.id}
              letter={LETTERS[i] ?? String(i + 1)}
              label={c.text}
              checked={selectedChoiceId === c.id}
              onSelect={onAnswer}
              disabled={answered || pending}
              review={
                answered && correctChoiceId !== undefined
                  ? { isCorrect: c.id === correctChoiceId, isSelected: c.id === selectedChoiceId }
                  : undefined
              }
            />
          ))}
        </div>
      </fieldset>
      {feedback && (
        <FeedbackPanel
          correct={feedback.correct}
          explanation={feedback.explanation}
          title={feedback.title}
        />
      )}
      <div className={styles.actions}>
        <Button
          iconEnd={ArrowRight}
          softDisabled={!answered}
          aria-describedby={answered ? undefined : `${name}-hint`}
          onClick={onNext}
        >
          {nextLabel}
        </Button>
        {!answered && (
          <span id={`${name}-hint`} className={styles.hint}>
            Choose an answer to continue
          </span>
        )}
      </div>
    </div>
  );
}
