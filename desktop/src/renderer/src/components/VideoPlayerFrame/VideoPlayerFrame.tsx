import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Captions, FileText, Pause, Play, Volume2, VolumeX } from '../../icons';
import { cx } from '../../lib/cx';
import { EmptyState } from '../EmptyState';
import { ErrorState } from '../ErrorState';
import { IconButton } from '../IconButton';
import { Spinner } from '../Spinner';
import styles from './VideoPlayerFrame.module.css';

export interface VideoPlayerFrameProps {
  title: string;
  /** Video URL (CDN, wired by engineers). */
  src?: string | undefined;
  /** WebVTT captions URL. Captions are required for prerecorded video (WCAG 1.2.2). */
  captionsSrc?: string | undefined;
  captionsLang?: string | undefined;
  captionsLabel?: string | undefined;
  poster?: string | undefined;
  state?: 'ready' | 'loading' | 'error' | 'empty' | undefined;
  onRetry?: (() => void) | undefined;
  /** Seam: progress reporting for the "watched" rule (decided outside the UI). */
  onProgress?: ((currentSeconds: number, durationSeconds: number) => void) | undefined;
  onEnded?: (() => void) | undefined;
  transcriptOpen?: boolean | undefined;
  onToggleTranscript?: (() => void) | undefined;
  className?: string | undefined;
}

export function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const SEEK_STEP = 5;

/**
 * Native <video> with custom 44px controls. Keyboard: Space/K play-pause, Left/Right seek 5s,
 * M mute, C captions (when the player region has focus). No autoplay.
 */
export function VideoPlayerFrame({
  title,
  src,
  captionsSrc,
  captionsLang = 'en',
  captionsLabel = 'English',
  poster,
  state = 'ready',
  onRetry,
  onProgress,
  onEnded,
  transcriptOpen = false,
  onToggleTranscript,
  className,
}: VideoPlayerFrameProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffering, setBuffering] = useState(false);

  useEffect(() => {
    const track = videoRef.current?.textTracks[0];
    if (track) track.mode = captionsOn ? 'showing' : 'hidden';
  }, [captionsOn, src]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      const p = v.play() as Promise<void> | undefined;
      p?.catch(() => {
        setPlaying(false);
      });
    } else {
      v.pause();
    }
  };

  const seekTo = (seconds: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(seconds, 0), duration || 0);
    setTime(v.currentTime);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const key = e.key.toLowerCase();
    if (key === ' ' || key === 'k') togglePlay();
    else if (key === 'arrowright') seekTo(time + SEEK_STEP);
    else if (key === 'arrowleft') seekTo(time - SEEK_STEP);
    else if (key === 'm') setMuted((m) => !m);
    else if (key === 'c' && captionsSrc) setCaptionsOn((c) => !c);
    else return;
    e.preventDefault();
  };

  if (state === 'error') {
    return (
      <div className={cx(styles.frame, styles.message, className)}>
        <ErrorState
          title="Video unavailable"
          description="The video could not be loaded."
          onRetry={onRetry}
        />
      </div>
    );
  }
  if (state === 'empty') {
    return (
      <div className={cx(styles.frame, styles.message, className)}>
        <EmptyState icon={Play} title="No video for this lesson" />
      </div>
    );
  }

  const loading = state === 'loading' || buffering;

  /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex, jsx-a11y/media-has-caption --
     The player group is focusable so it can take the documented keyboard shortcuts. Captions
     render whenever captionsSrc is supplied; when it is missing the Captions control says so. */
  return (
    <div className={cx(styles.root, className)}>
      <div
        role="group"
        aria-label={`Video: ${title}. Space to play or pause, arrow keys to seek.`}
        tabIndex={0}
        className={styles.frame}
        onKeyDown={onKeyDown}
      >
        <video
          ref={videoRef}
          className={styles.video}
          src={state === 'loading' ? undefined : src}
          poster={poster}
          muted={muted}
          preload="metadata"
          playsInline
          onPlay={() => {
            setPlaying(true);
          }}
          onPause={() => {
            setPlaying(false);
          }}
          onWaiting={() => {
            setBuffering(true);
          }}
          onPlaying={() => {
            setBuffering(false);
          }}
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration);
          }}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            setTime(v.currentTime);
            onProgress?.(v.currentTime, v.duration);
          }}
          onEnded={() => {
            setPlaying(false);
            onEnded?.();
          }}
        >
          {captionsSrc && (
            <track
              kind="captions"
              src={captionsSrc}
              srcLang={captionsLang}
              label={captionsLabel}
              default
            />
          )}
        </video>
        {loading && (
          <div className={styles.overlay}>
            <Spinner size="lg" label={state === 'loading' ? 'Loading video' : 'Buffering'} />
          </div>
        )}
      </div>
      <div className={styles.controls}>
        <IconButton
          icon={playing ? Pause : Play}
          label={playing ? 'Pause' : 'Play'}
          onClick={togglePlay}
          disabled={state === 'loading'}
        />
        <span className={styles.time} aria-hidden="true">
          {formatTime(time)} / {formatTime(duration)}
        </span>
        <input
          type="range"
          className={styles.seek}
          aria-label="Seek"
          aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}`}
          min={0}
          max={duration || 0}
          step={1}
          value={Math.floor(time)}
          disabled={state === 'loading' || !duration}
          onChange={(e) => {
            seekTo(Number(e.currentTarget.value));
          }}
        />
        <IconButton
          icon={muted ? VolumeX : Volume2}
          label={muted ? 'Unmute' : 'Mute'}
          aria-pressed={muted}
          onClick={() => {
            setMuted((m) => !m);
          }}
        />
        <IconButton
          icon={Captions}
          label={
            captionsSrc ? (captionsOn ? 'Hide captions' : 'Show captions') : 'No captions available'
          }
          aria-pressed={captionsSrc ? captionsOn : undefined}
          disabled={!captionsSrc}
          onClick={() => {
            setCaptionsOn((c) => !c);
          }}
        />
        {onToggleTranscript && (
          <IconButton
            icon={FileText}
            label={transcriptOpen ? 'Hide transcript' : 'Show transcript'}
            aria-pressed={transcriptOpen}
            onClick={onToggleTranscript}
          />
        )}
      </div>
    </div>
  );
  /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex, jsx-a11y/media-has-caption */
}
