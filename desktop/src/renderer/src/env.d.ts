/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional contact line for the restricted-access screen (client branding is pending). */
  readonly RENDERER_VITE_SECURITY_CONTACT_TEXT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
