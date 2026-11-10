/**
 * IPC registry (plan 4.4, ADR 0013 item 3; mirrors the server route registry of ADR 0005).
 *
 * Every channel is declared with a strict zod input schema and a handler. Every invoke goes through
 * the same pipeline: sender check, rate guard, size cap, schema validation, handler. Handlers return
 * values; thrown errors are logged by name only and surface as `{ ok: false, code: 'INTERNAL' }`, so
 * stack traces never reach the renderer.
 */
import type { z } from 'zod';
import {
  IPC_INPUT_SCHEMAS,
  IPC_MAX_CALLS_PER_SECOND,
  IPC_MAX_PAYLOAD_BYTES,
  channelFor,
  declaredMethodKeys,
  type DesktopError,
  type IpcMethodKey,
} from '../../shared/ipc';
import type { Logger } from '../log';

/** Minimal slice of `ipcMain` used here. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

type Schemas = typeof IPC_INPUT_SCHEMAS;

export type IpcHandlers = {
  [K in IpcMethodKey]: (input: z.output<Schemas[K]>) => unknown;
};

export interface IpcRegistryDeps {
  ipc: IpcMainLike;
  /** True only for the main window's top-level frame on the app origin. */
  validateSender: (event: unknown) => boolean;
  log: Logger;
  now?: () => number;
  /** Overridable for tests (a registry with a missing schema must refuse to start). */
  schemas?: Readonly<Record<string, z.ZodType>>;
}

export function ipcFailure(
  code: DesktopError['code'],
  message: string,
): {
  ok: false;
  error: DesktopError;
} {
  return { ok: false, error: { code, message } };
}

function payloadBytes(args: unknown[]): number {
  try {
    return new TextEncoder().encode(JSON.stringify(args)).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function assertIpcRegistry(
  registered: readonly string[],
  schemaKeys: readonly string[],
  preloadChannels: readonly string[],
): void {
  const declared = declaredMethodKeys();
  const dupes = registered.filter((k, i) => registered.indexOf(k) !== i);
  if (dupes.length > 0) throw new Error(`IPC registry: duplicate channels ${dupes.join(', ')}`);
  for (const key of declared) {
    if (!schemaKeys.includes(key)) throw new Error(`IPC registry: channel ${key} has no schema`);
    if (!registered.includes(key)) throw new Error(`IPC registry: channel ${key} has no handler`);
  }
  for (const key of registered) {
    if (!declared.includes(key)) throw new Error(`IPC registry: undeclared channel ${key}`);
  }
  const expected = declared.map(channelFor).sort();
  const actual = [...preloadChannels].sort();
  if (expected.length !== actual.length || expected.some((c, i) => c !== actual[i])) {
    throw new Error('IPC registry: preload channel list differs from the registry');
  }
}

export class IpcRegistry {
  private readonly calls = new Map<string, number[]>();
  private readonly registered: string[] = [];
  private readonly now: () => number;
  private readonly schemas: Readonly<Record<string, z.ZodType>>;

  constructor(private readonly deps: IpcRegistryDeps) {
    this.now = deps.now ?? Date.now;
    this.schemas = deps.schemas ?? IPC_INPUT_SCHEMAS;
  }

  /** Registers every handler, then asserts the registry against the declared inventory. */
  register(handlers: Partial<IpcHandlers>, preloadChannels: readonly string[]): void {
    for (const [key, handler] of Object.entries(handlers)) {
      this.registerOne(key, handler as (input: unknown) => unknown);
    }
    assertIpcRegistry(this.registered, Object.keys(this.schemas), preloadChannels);
  }

  dispose(): void {
    for (const key of this.registered) this.deps.ipc.removeHandler(channelFor(key));
    this.registered.length = 0;
  }

  channelKeys(): readonly string[] {
    return this.registered;
  }

  private registerOne(key: string, handler: (input: unknown) => unknown): void {
    this.registered.push(key);
    const channel = channelFor(key);
    this.deps.ipc.handle(channel, (event, ...args) => this.invoke(key, handler, event, args));
  }

  private rateLimited(key: string): boolean {
    const t = this.now();
    const recent = (this.calls.get(key) ?? []).filter((x) => t - x < 1000);
    recent.push(t);
    this.calls.set(key, recent);
    return recent.length > IPC_MAX_CALLS_PER_SECOND;
  }

  private async invoke(
    key: string,
    handler: (input: unknown) => unknown,
    event: unknown,
    args: unknown[],
  ): Promise<unknown> {
    const { log } = this.deps;
    if (!this.deps.validateSender(event)) {
      log.warn('ipc.forbidden_sender', { channel: key });
      return ipcFailure('FORBIDDEN_SENDER', 'Request not allowed.');
    }
    if (this.rateLimited(key)) {
      log.warn('ipc.rate_limited', { channel: key });
      return ipcFailure('INVALID_INPUT', 'Too many requests.');
    }
    if (args.length > 1 || payloadBytes(args) > IPC_MAX_PAYLOAD_BYTES) {
      log.warn('ipc.payload_rejected', { channel: key });
      return ipcFailure('INVALID_INPUT', 'Invalid request.');
    }
    const schema = this.schemas[key];
    if (!schema) return ipcFailure('INTERNAL', 'Unexpected error.');
    const parsed = schema.safeParse(args[0]);
    if (!parsed.success) {
      // Never echo the submitted value (it may be a password).
      log.warn('ipc.invalid_input', { channel: key });
      return ipcFailure('INVALID_INPUT', 'Invalid request.');
    }
    try {
      return await handler(parsed.data);
    } catch (err) {
      log.error('ipc.handler_threw', {
        channel: key,
        name: err instanceof Error ? err.name : 'unknown',
      });
      return ipcFailure('INTERNAL', 'Unexpected error.');
    }
  }
}
