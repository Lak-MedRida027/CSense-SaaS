import type { CSenseBridgeV1 } from '../shared/ipcChannels';

/** `window.csense` is produced by the preload (ADR 0013) and consumed by the renderer. */
export type CSenseBridge = CSenseBridgeV1;

declare global {
  interface Window {
    readonly csense?: CSenseBridgeV1;
  }

  /** Injected at build time by electron.vite.config.ts. */
  const __APP_VERSION__: string;
}
