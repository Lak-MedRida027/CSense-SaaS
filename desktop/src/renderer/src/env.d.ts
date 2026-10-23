/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly RENDERER_VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
