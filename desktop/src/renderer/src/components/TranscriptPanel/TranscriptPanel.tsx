import { useId } from 'react';
import { cx } from '../../lib/cx';
import { EmptyState } from '../EmptyState';
import { SkeletonText } from '../Skeleton';
import { formatTime } from '../VideoPlayerFrame/VideoPlayerFrame';
import styles from './TranscriptPanel.module.css';

export interface TranscriptCue {
  id: string;
  startSeconds: number;
  text: string;
}

export interface TranscriptPanelProps {
  cues: readonly TranscriptCue[];
  /** Cue matching the current playback time. */
  activeCueId?: string | undefined;
  /** Seam: jump the video to a cue. Without it, timestamps are plain text. */
  onSeek?: ((seconds: number) => void) | undefined;
  loading?: boolean | undefined;
  title?: string | undefined;
  className?: string | undefined;
}

/** Scrollable, keyboard-focusable transcript region. */
export function TranscriptPanel({
  cues,
  activeCueId,
  onSeek,
  loading = false,
  title = 'Transcript',
  className,
}: TranscriptPanelProps) {
  const headingId = useId();
  return (
    <div className={cx(styles.root, className)}>
      <h3 id={headingId} className={styles.heading}>
        {title}
      </h3>
      <div
        role="region"
        aria-labelledby={headingId}
        // Scrollable region must be focusable for keyboard scrolling (axe scrollable-region-focusable).
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        className={styles.scroll}
        aria-busy={loading || undefined}
      >
        {loading ? (
          <SkeletonText lines={6} />
        ) : cues.length === 0 ? (
          <EmptyState title="No transcript available" compact />
        ) : (
          <ol className={styles.list}>
            {cues.map((cue) => (
              <li
                key={cue.id}
                className={cx(styles.cue, cue.id === activeCueId && styles.active)}
                aria-current={cue.id === activeCueId ? 'true' : undefined}
              >
                {onSeek ? (
                  <button
                    type="button"
                    className={styles.time}
                    aria-label={`Jump to ${formatTime(cue.startSeconds)}`}
                    onClick={() => {
                      onSeek(cue.startSeconds);
                    }}
                  >
                    {formatTime(cue.startSeconds)}
                  </button>
                ) : (
                  <span className={styles.time}>{formatTime(cue.startSeconds)}</span>
                )}
                <p>{cue.text}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
