/**
 * Motion is purposeful only: feedback, continuity, reward. Nothing loops or autoplays > 5s.
 *
 * Rule for component authors: use `fast` for colour/opacity transitions only. Anything that
 * moves or scales uses `base` or longer, which reduced-motion collapses to ~0.
 */
export const duration = {
  instant: '0ms',
  fast: '120ms',
  base: '200ms',
  slow: '320ms',
  deliberate: '480ms',
  celebrate: '900ms',
} as const;

export type DurationName = keyof typeof duration;

/** Durations under reduced motion: everything collapses except `fast` opacity/colour fades. */
export const reducedDuration: Record<DurationName, string> = {
  instant: '0ms',
  fast: '120ms',
  base: '0.01ms',
  slow: '0.01ms',
  deliberate: '0.01ms',
  celebrate: '0.01ms',
};

export const easing = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  enter: 'cubic-bezier(0, 0, 0, 1)',
  exit: 'cubic-bezier(0.3, 0, 1, 1)',
  /** Slight overshoot; celebrations only. */
  emphasized: 'cubic-bezier(0.3, 0, 0, 1.15)',
} as const;

/** Small transform amounts; reduced motion neutralises them. */
export const motionScale = {
  pressScale: '0.98',
  enterDistance: '8px',
} as const;

export const reducedMotionScale: Record<keyof typeof motionScale, string> = {
  pressScale: '1',
  enterDistance: '0px',
};
