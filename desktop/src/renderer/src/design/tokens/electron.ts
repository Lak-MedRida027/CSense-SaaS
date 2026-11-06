import { neutral } from './primitives';

/**
 * Values the Electron main process needs before the renderer paints (window background),
 * kept equal to `surface.canvas` so there is no flash between window creation and first paint.
 * Imported by `desktop/src/main/index.ts`; must stay DOM-free.
 */
export const WINDOW_BACKGROUND = {
  dark: neutral[975],
  light: neutral[25],
} as const;
