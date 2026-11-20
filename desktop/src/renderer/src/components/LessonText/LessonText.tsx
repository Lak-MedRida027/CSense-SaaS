import { cx } from '../../lib/cx';
import styles from './LessonText.module.css';

export interface LessonTextProps {
  /** Authored plain text. Paragraphs are separated by blank lines. Never interpreted as HTML. */
  text: string;
  className?: string | undefined;
}

/** Splits on blank lines; every paragraph is rendered as a text node (D6-18, no Markdown or HTML). */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\r?\n[ \t]*\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function LessonText({ text, className }: LessonTextProps) {
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length === 0) return null;
  return (
    <div className={cx(styles.root, className)}>
      {paragraphs.map((p, i) => (
        <p key={i} className={styles.paragraph}>
          {p}
        </p>
      ))}
    </div>
  );
}
