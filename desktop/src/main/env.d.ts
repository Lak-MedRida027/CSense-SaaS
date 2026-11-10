/** Build-time values injected by electron-vite into the main bundle (MAIN_VITE_* only). */
interface ImportMetaEnv {
  readonly [key: `MAIN_VITE_${string}`]: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
