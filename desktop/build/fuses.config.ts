/**
 * Electron fuse values for packaged builds (plan 4.1, ADR 0013 item 8).
 *
 * Values only. Nothing applies them yet: Playwright needs the inspector on unpackaged builds, and the
 * Phase 10 packaging step flips these with @electron/fuses when it signs and packages the installer.
 */
export const PACKAGED_FUSES = {
  /** ELECTRON_RUN_AS_NODE would turn the binary into a plain Node.js shell. */
  RunAsNode: false,
  /** NODE_OPTIONS must not reach the main process. */
  EnableNodeOptionsEnvironmentVariable: false,
  /** --inspect and friends. */
  EnableNodeCliInspectArguments: false,
  /** The app code may only load from the signed ASAR. */
  OnlyLoadAppFromAsar: true,
  EnableEmbeddedAsarIntegrityValidation: true,
  /** Cookies (none are used) are encrypted with the OS key. */
  EnableCookieEncryption: true,
  /** file:// gets no special privileges; the renderer is served from app://. */
  GrantFileProtocolExtraPrivileges: false,
} as const;
