/**
 * Port interfaces: the narrow slice of Electron and Node that main-process logic is allowed to use
 * (ADR 0013 item 9). Controllers depend on these types only, so they are unit-tested with fakes.
 * The real implementations live in `ports.ts`, the only file that wires them to `electron`.
 */

export interface FsPort {
  readFile(path: string): Promise<Buffer | null>;
  writeFile(path: string, data: string | Buffer): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  mkdir(dir: string): Promise<void>;
  appendFile(path: string, data: string): Promise<void>;
  fileSize(path: string): Promise<number>;
}

/** Async API: the synchronous safeStorage methods are deprecated since Electron 4x. */
export interface SafeStoragePort {
  isEncryptionAvailable(): Promise<boolean>;
  /** `basic_text` (Linux without a keyring) is treated as unavailable. Other platforms: any string. */
  selectedBackend(): string;
  encryptString(plain: string): Promise<Buffer>;
  decryptString(blob: Buffer): Promise<string>;
}

export interface ClipboardPort {
  clear(): void;
  readText(): Promise<string>;
}

export interface GlobalShortcutPort {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export interface NotificationPort {
  isSupported(): boolean;
  show(opts: { title: string; body: string }, onClick: () => void): void;
}

export type PowerEvent = 'unlock-screen' | 'resume' | 'shutdown';
export interface PowerPort {
  on(event: PowerEvent, callback: () => void): () => void;
}

export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
  redirect: 'error';
  credentials: 'omit';
}
/** The API session's fetch (separate in-memory partition; never used by the renderer). */
export type FetchPort = (url: string, init: FetchInit) => Promise<Response>;

/** Subset of Electron's `Input` used by the filter. */
export interface InputEventLike {
  type: string;
  key: string;
  code: string;
  control: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  isAutoRepeat?: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayInfo {
  id: number;
  bounds: Rect;
}

export interface CoverWindowPort {
  setBounds(bounds: Rect): void;
  close(): void;
}

export interface DisplaysPort {
  all(): DisplayInfo[];
  /** The display the main window is on. */
  windowDisplayId(): number;
  onChange(callback: () => void): () => void;
  createCover(display: DisplayInfo): CoverWindowPort;
}

/** The single main window. All lock primitives and webContents events the controllers need. */
export interface WindowPort {
  isDestroyed(): boolean;
  show(): void;
  hide(): void;
  focus(): void;
  moveTop(): void;
  flashFrame(flag: boolean): void;
  center(): void;
  setSize(width: number, height: number): void;
  setKiosk(flag: boolean): void;
  setFullScreen(flag: boolean): void;
  setAlwaysOnTop(flag: boolean, level?: 'screen-saver'): void;
  setClosable(flag: boolean): void;
  setMinimizable(flag: boolean): void;
  setMovable(flag: boolean): void;
  setSkipTaskbar(flag: boolean): void;
  setContentProtection(flag: boolean): void;
  closeDevTools(): void;
  reload(): void;
  forcefullyCrashRenderer(): void;
  /** Push a main event to the renderer (payload only). */
  send(channel: string, payload: unknown): void;

  /** Handlers return `true` to prevent the default action. Each subscription returns an unsubscribe. */
  onBeforeInput(handler: (input: InputEventLike) => boolean): () => void;
  onClose(handler: () => boolean): () => void;
  onBlur(handler: () => void): () => void;
  onFocus(handler: () => void): () => void;
  onDevToolsOpened(handler: () => void): () => void;
  onRenderProcessGone(handler: (details: { reason: string }) => void): () => void;
  onUnresponsive(handler: () => void): () => void;
  onResponsive(handler: () => void): () => void;
  onSessionEnd(handler: () => void): () => void;
}
