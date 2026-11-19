import { useId, type ReactNode } from 'react';
import { CircleCheck, CircleX } from '../../icons';
import { cx } from '../../lib/cx';
import styles from './QuizOption.module.css';

export interface QuizOptionReview {
  /** This option is the correct answer. */
  isCorrect: boolean;
  /** The user picked this option. */
  isSelected: boolean;
  /**
   * The picked option was graded correct even though the key is not revealed (quizzes reveal the
   * correct option only after a pass, D3-13). Styles the pick as correct without a "Correct answer" tag.
   */
  selectedCorrect?: boolean | undefined;
}

export interface QuizOptionProps {
  /** Radio group name shared by all options of one question. */
  name: string;
  optionId: string;
  /** Visual letter, e.g. "A". */
  letter: string;
  label: ReactNode;
  checked: boolean;
  onSelect: (optionId: string) => void;
  disabled?: boolean | undefined;
  /** Review mode: shows "Your answer" / "Correct answer" tags with icons. Implies disabled. */
  review?: QuizOptionReview | undefined;
  className?: string | undefined;
}

/**
 * A native radio styled as a full-width card (the whole card is the click target). Must be
 * rendered inside a fieldset/radiogroup; arrow keys move between options natively.
 */
export function QuizOption({
  name,
  optionId,
  letter,
  label,
  checked,
  onSelect,
  disabled = false,
  review,
  className,
}: QuizOptionProps) {
  const id = useId();
  const reviewTone = review
    ? review.isCorrect || (review.isSelected && review.selectedCorrect)
      ? 'success'
      : review.isSelected
        ? 'critical'
        : undefined
    : undefined;

  return (
    <label
      htmlFor={id}
      className={cx(
        styles.option,
        checked && styles.checked,
        (disabled || review) && styles.disabled,
        reviewTone && styles.reviewed,
        className,
      )}
      data-tone={reviewTone}
    >
      <input
        id={id}
        type="radio"
        name={name}
        value={optionId}
        checked={checked}
        disabled={disabled || review !== undefined}
        onChange={() => {
          onSelect(optionId);
        }}
        className={styles.input}
      />
      <span className={styles.letter} aria-hidden="true">
        {letter}
      </span>
      <span className={styles.label}>{label}</span>
      {review && (review.isSelected || review.isCorrect) && (
        <span className={styles.tags}>
          {review.isSelected && (
            <span className={styles.tag}>
              {review.isCorrect || review.selectedCorrect ? (
                <CircleCheck aria-hidden="true" size={14} />
              ) : (
                <CircleX aria-hidden="true" size={14} />
              )}
              Your answer
            </span>
          )}
          {review.isCorrect && (
            <span className={styles.tag}>
              <CircleCheck aria-hidden="true" size={14} />
              Correct answer
            </span>
          )}
        </span>
      )}
    </label>
  );
}
