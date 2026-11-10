/**
 * Test doubles for the Electron ports (ADR 0013 item 9). Not shipped: only imported by *.test.ts.
 */
import type {
  ClipboardPort,
  CoverWindowPort,
  DisplayInfo,
  DisplaysPort,
  FetchInit,
  FetchPort,
  FsPort,
  GlobalShortcutPort,
  InputEventLike,
  NotificationPort,
  PowerEvent,
  PowerPort,
  Rect,
  SafeStoragePort,
  WindowPort,
} from '../electron/types';
import { noopLogger, type Logger } from '../log';

export class FakeFs implements FsPort {
  files = new Map<string, Buffer>();
  ops: string[] = [];
  failWrites = false;

  readFile(path: string): Promise<Buffer | null> {
    return Promise.resolve(this.files.get(path) ?? null);
  }
  writeFile(path: string, data: string | Buffer): Promise<void> {
    this.ops.push(`write:${path}`);
    if (this.failWrites) return Promise.reject(new Error('disk full'));
    this.files.set(path, Buffer.from(data));
    return Promise.resolve();
  }
  rename(from: string, to: string): Promise<void> {
    this.ops.push(`rename:${from}->${to}`);
    const f = this.files.get(from);
    if (f === undefined) return Promise.reject(new Error('ENOENT'));
    this.files.delete(from);
    this.files.set(to, f);
    return Promise.resolve();
  }
  unlink(path: string): Promise<void> {
    this.ops.push(`unlink:${path}`);
    this.files.delete(path);
    return Promise.resolve();
  }
  mkdir(): Promise<void> {
    return Promise.resolve();
  }
  appendFile(path: string, data: string): Promise<void> {
    const cur = this.files.get(path) ?? Buffer.alloc(0);
    this.files.set(path, Buffer.concat([cur, Buffer.from(data)]));
    return Promise.resolve();
  }
  fileSize(path: string): Promise<number> {
    return Promise.resolve(this.files.get(path)?.length ?? 0);
  }
  text(path: string): string | null {
    return this.files.get(path)?.toString('utf8') ?? null;
  }
}

/** XOR "encryption": enough to prove the plaintext is never what lands on disk. */
export class FakeSafeStorage implements SafeStoragePort {
  available = true;
  backend = 'os_default';
  isEncryptionAvailable(): Promise<boolean> {
    return Promise.resolve(this.available);
  }
  selectedBackend(): string {
    return this.backend;
  }
  encryptString(plain: string): Promise<Buffer> {
    return Promise.resolve(Buffer.from(Buffer.from(plain, 'utf8').map((b) => b ^ 0x5a)));
  }
  decryptString(blob: Buffer): Promise<string> {
    if (blob.length === 0 || blob[0] === 0xff) return Promise.reject(new Error('cannot decrypt'));
    return Promise.resolve(Buffer.from(blob.map((b) => b ^ 0x5a)).toString('utf8'));
  }
}

export class FakeClipboard implements ClipboardPort {
  text = '';
  clears = 0;
  clear(): void {
    this.text = '';
    this.clears++;
  }
  readText(): Promise<string> {
    return Promise.resolve(this.text);
  }
}

export class FakeGlobalShortcut implements GlobalShortcutPort {
  registered = new Set<string>();
  register(accelerator: string): boolean {
    this.registered.add(accelerator);
    return true;
  }
  unregister(accelerator: string): void {
    this.registered.delete(accelerator);
  }
}

export class FakeNotification implements NotificationPort {
  supported = true;
  shown: { title: string; body: string; click: () => void }[] = [];
  isSupported(): boolean {
    return this.supported;
  }
  show(opts: { title: string; body: string }, onClick: () => void): void {
    this.shown.push({ ...opts, click: onClick });
  }
}

export class FakePower implements PowerPort {
  private readonly handlers = new Map<PowerEvent, Set<() => void>>();
  on(event: PowerEvent, callback: () => void): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(callback);
    this.handlers.set(event, set);
    return () => {
      set.delete(callback);
    };
  }
  fire(event: PowerEvent): void {
    for (const h of [...(this.handlers.get(event) ?? [])]) h();
  }
}

export class FakeDisplays implements DisplaysPort {
  displays: DisplayInfo[] = [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }];
  mainId = 1;
  covers = new Map<number, { bounds: Rect; closed: boolean }>();
  private listeners = new Set<() => void>();
  all(): DisplayInfo[] {
    return this.displays;
  }
  windowDisplayId(): number {
    return this.mainId;
  }
  onChange(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }
  createCover(display: DisplayInfo): CoverWindowPort {
    const rec = { bounds: display.bounds, closed: false };
    this.covers.set(display.id, rec);
    return {
      setBounds: (b) => {
        rec.bounds = b;
      },
      close: () => {
        rec.closed = true;
      },
    };
  }
  change(): void {
    for (const l of [...this.listeners]) l();
  }
  get openCovers(): number {
    return [...this.covers.values()].filter((c) => !c.closed).length;
  }
}

type Handlers<T> = Set<T>;

export class FakeWindow implements WindowPort {
  destroyed = false;
  log: string[] = [];
  sent: { channel: string; payload: unknown }[] = [];
  visible = false;
  focused = false;
  kiosk = false;
  fullScreen = false;
  alwaysOnTop = false;
  closable = true;
  minimizable = true;
  movable = true;
  skipTaskbar = false;
  contentProtected = false;
  devToolsOpen = false;
  reloads = 0;
  crashes = 0;
  size = { width: 0, height: 0 };

  private beforeInput: Handlers<(i: InputEventLike) => boolean> = new Set();
  private close: Handlers<() => boolean> = new Set();
  private blur: Handlers<() => void> = new Set();
  private focus_: Handlers<() => void> = new Set();
  private devtools: Handlers<() => void> = new Set();
  private gone: Handlers<(d: { reason: string }) => void> = new Set();
  private unresp: Handlers<() => void> = new Set();
  private resp: Handlers<() => void> = new Set();
  private sessionEnd: Handlers<() => void> = new Set();

  isDestroyed(): boolean {
    return this.destroyed;
  }
  show(): void {
    this.visible = true;
    this.log.push('show');
  }
  hide(): void {
    this.visible = false;
    this.log.push('hide');
  }
  focus(): void {
    this.focused = true;
    this.log.push('focus');
  }
  moveTop(): void {
    this.log.push('moveTop');
  }
  flashFrame(flag: boolean): void {
    this.log.push(`flash:${String(flag)}`);
  }
  center(): void {
    this.log.push('center');
  }
  setSize(width: number, height: number): void {
    this.size = { width, height };
  }
  setKiosk(f: boolean): void {
    this.kiosk = f;
  }
  setFullScreen(f: boolean): void {
    this.fullScreen = f;
  }
  setAlwaysOnTop(f: boolean): void {
    this.alwaysOnTop = f;
  }
  setClosable(f: boolean): void {
    this.closable = f;
  }
  setMinimizable(f: boolean): void {
    this.minimizable = f;
  }
  setMovable(f: boolean): void {
    this.movable = f;
  }
  setSkipTaskbar(f: boolean): void {
    this.skipTaskbar = f;
  }
  setContentProtection(f: boolean): void {
    this.contentProtected = f;
  }
  closeDevTools(): void {
    this.devToolsOpen = false;
    this.log.push('closeDevTools');
  }
  reload(): void {
    this.reloads++;
  }
  forcefullyCrashRenderer(): void {
    this.crashes++;
  }
  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload });
  }

  onBeforeInput(h: (i: InputEventLike) => boolean): () => void {
    this.beforeInput.add(h);
    return () => this.beforeInput.delete(h);
  }
  onClose(h: () => boolean): () => void {
    this.close.add(h);
    return () => this.close.delete(h);
  }
  onBlur(h: () => void): () => void {
    this.blur.add(h);
    return () => this.blur.delete(h);
  }
  onFocus(h: () => void): () => void {
    this.focus_.add(h);
    return () => this.focus_.delete(h);
  }
  onDevToolsOpened(h: () => void): () => void {
    this.devtools.add(h);
    return () => this.devtools.delete(h);
  }
  onRenderProcessGone(h: (d: { reason: string }) => void): () => void {
    this.gone.add(h);
    return () => this.gone.delete(h);
  }
  onUnresponsive(h: () => void): () => void {
    this.unresp.add(h);
    return () => this.unresp.delete(h);
  }
  onResponsive(h: () => void): () => void {
    this.resp.add(h);
    return () => this.resp.delete(h);
  }
  onSessionEnd(h: () => void): () => void {
    this.sessionEnd.add(h);
    return () => this.sessionEnd.delete(h);
  }

  // ---- test drivers ----
  /** True if the input was prevented. */
  press(input: Partial<InputEventLike> & { key: string }): boolean {
    const full: InputEventLike = {
      type: 'keyDown',
      code: '',
      control: false,
      shift: false,
      alt: false,
      meta: false,
      ...input,
    };
    let prevented = false;
    for (const h of this.beforeInput) if (h(full)) prevented = true;
    return prevented;
  }
  /** True if the close was prevented. */
  tryClose(): boolean {
    let prevented = false;
    for (const h of this.close) if (h()) prevented = true;
    return prevented;
  }
  doBlur(): void {
    this.focused = false;
    for (const h of this.blur) h();
  }
  doFocus(): void {
    this.focused = true;
    for (const h of this.focus_) h();
  }
  openDevTools(): void {
    this.devToolsOpen = true;
    for (const h of this.devtools) h();
  }
  crash(reason = 'crashed'): void {
    for (const h of this.gone) h({ reason });
  }
  hang(): void {
    for (const h of this.unresp) h();
  }
  recover(): void {
    for (const h of this.resp) h();
  }
  endSession(): void {
    for (const h of this.sessionEnd) h();
  }
}

export interface FakeRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}
export interface FakeReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Simulate a transport failure. */
  throws?: boolean;
  /** Resolve only after this promise settles (concurrency tests). */
  gate?: Promise<void>;
}
export type RouteHandler = (req: FakeRequest) => FakeReply | Promise<FakeReply>;

export const jsonReply = (
  status: number,
  body?: unknown,
  headers?: Record<string, string>,
): FakeReply => ({
  status,
  ...(body !== undefined ? { body } : {}),
  ...(headers ? { headers } : {}),
});

export const apiError = (
  status: number,
  code: string,
  extra?: { details?: unknown; headers?: Record<string, string> },
): FakeReply => ({
  status,
  body: { error: { code, message: code, ...(extra?.details ? { details: extra.details } : {}) } },
  ...(extra?.headers ? { headers: extra.headers } : {}),
});

/** A fake API: routes keyed "METHOD /path". Records every request. */
export class FakeApi {
  routes = new Map<string, RouteHandler>();
  requests: FakeRequest[] = [];
  readonly baseUrl = 'https://api.test/api/v1';

  on(key: string, handler: RouteHandler | FakeReply): void {
    this.routes.set(key, typeof handler === 'function' ? handler : () => handler);
  }
  count(key: string): number {
    return this.requests.filter((r) => `${r.method} ${r.path}` === key).length;
  }

  readonly fetch: FetchPort = async (url: string, init: FetchInit) => {
    const path = url.slice(this.baseUrl.length);
    const req: FakeRequest = {
      method: init.method,
      path,
      headers: init.headers,
      body: init.body !== undefined ? (JSON.parse(init.body) as unknown) : undefined,
    };
    this.requests.push(req);
    const handler = this.routes.get(`${init.method} ${path}`);
    const reply = handler ? await handler(req) : apiError(404, 'NOT_FOUND');
    if (reply.throws) throw new TypeError('network down');
    if (reply.gate) await reply.gate;
    const hasBody = reply.body !== undefined;
    return new Response(hasBody ? JSON.stringify(reply.body) : null, {
      status: reply.status,
      headers: { 'content-type': 'application/json', ...(reply.headers ?? {}) },
    });
  };
}

export function recordingLogger(): Logger & { events: { event: string; data?: unknown }[] } {
  const events: { event: string; data?: unknown }[] = [];
  const rec =
    () =>
    (event: string, data?: Record<string, unknown>): void => {
      events.push({ event, data });
    };
  return { ...noopLogger, debug: rec(), info: rec(), warn: rec(), error: rec(), events };
}
