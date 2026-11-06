/** 4px grid. `--cs-space-{n}`. */
export const space = {
  0: '0',
  1: '0.125rem',
  2: '0.25rem',
  3: '0.5rem',
  4: '0.75rem',
  5: '1rem',
  6: '1.25rem',
  7: '1.5rem',
  8: '2rem',
  9: '2.5rem',
  10: '3rem',
  11: '4rem',
  12: '5rem',
} as const;

/** Fixed sizes. `targetMin` is the 44px minimum hit area for every interactive element. */
export const size = {
  targetMin: '44px',
  controlSm: '32px',
  controlMd: '44px',
  controlLg: '52px',
  tableRow: '48px',
  iconSm: '16px',
  iconMd: '20px',
  iconLg: '24px',
  sidebar: '248px',
  contentMax: '1200px',
  readingMax: '72ch',
  focusRingWidth: '2px',
  focusRingOffset: '2px',
} as const;

export const radius = {
  none: '0',
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  pill: '999px',
} as const;
