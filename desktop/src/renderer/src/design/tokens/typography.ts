/** Inter and JetBrains Mono are bundled locally (OFL 1.1, see assets/fonts/OFL.txt). */
export const fontFamily = {
  sans: '"Inter Variable", Inter, system-ui, "Segoe UI", Roboto, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, Consolas, "Cascadia Mono", monospace',
} as const;

export interface TypeStep {
  size: string;
  lineHeight: string;
}

/** rem-based so the onboarding "text size" preference scales the whole UI. Base 16px. */
export const typeScale = {
  xs: { size: '0.75rem', lineHeight: '1rem' },
  sm: { size: '0.875rem', lineHeight: '1.25rem' },
  md: { size: '1rem', lineHeight: '1.5rem' },
  lg: { size: '1.125rem', lineHeight: '1.75rem' },
  xl: { size: '1.25rem', lineHeight: '1.75rem' },
  '2xl': { size: '1.5rem', lineHeight: '2rem' },
  '3xl': { size: '1.875rem', lineHeight: '2.375rem' },
  '4xl': { size: '2.25rem', lineHeight: '2.75rem' },
  display: { size: '3rem', lineHeight: '3.5rem' },
} as const satisfies Record<string, TypeStep>;

export type TypeStepName = keyof typeof typeScale;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export const letterSpacing = {
  normal: '0',
  tight: '-0.01em',
  caps: '0.06em',
} as const;
