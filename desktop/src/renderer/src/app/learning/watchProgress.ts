/**
 * The "watched" rule for video lessons (ADR 0019, D6-5). Pure and client-side only: nothing here is
 * recorded or rewards anything (a modified client can skip it, and gains nothing by doing so).
 *
 * `furthest` is the furthest contiguous position reached by playing: a `timeupdate` advances it only
 * if it is within `TOLERANCE_SECONDS` of the current furthest point. Seeking back is free; seeking
 * forward does not count until playback actually covers the gap.
 */
export const WATCHED_FRACTION = 0.9;
export const TOLERANCE_SECONDS = 2;

export interface WatchTracker {
  update(currentSeconds: number, durationSeconds: number): void;
  /** Playback ran to the end (the `ended` event). */
  ended(durationSeconds: number): void;
  reset(): void;
  furthest(): number;
  watched(): boolean;
}

export function createWatchTracker(): WatchTracker {
  let furthest = 0;
  let duration = 0;
  let endedAtDuration = false;
  const valid = (n: number): boolean => Number.isFinite(n) && n >= 0;
  return {
    update(current, dur) {
      if (!valid(current) || !valid(dur) || dur === 0) return;
      duration = dur;
      if (current > furthest && current <= furthest + TOLERANCE_SECONDS) furthest = current;
    },
    ended(dur) {
      // `ended` fires only when playback reaches the end, but a forward seek to the very end also
      // ends the media; only count it when the contiguous position is close.
      if (!valid(dur) || dur === 0) return;
      duration = dur;
      if (furthest >= dur - TOLERANCE_SECONDS) {
        furthest = dur;
        endedAtDuration = true;
      }
    },
    reset() {
      furthest = 0;
      duration = 0;
      endedAtDuration = false;
    },
    furthest: () => furthest,
    watched: () => duration > 0 && (endedAtDuration || furthest >= WATCHED_FRACTION * duration),
  };
}
