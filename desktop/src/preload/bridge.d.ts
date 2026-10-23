/** Shape of `window.csense`, shared by the preload (producer) and the renderer (consumer). */
export interface CSenseBridge {
  readonly appVersion: string;
}

declare global {
  interface Window {
    readonly csense?: CSenseBridge;
  }

  /** Injected at build time by electron.vite.config.ts. */
  const __APP_VERSION__: string;
}
