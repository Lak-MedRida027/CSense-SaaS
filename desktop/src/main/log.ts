/**
 * Redacting JSON-lines logger (plan 5.3). Rotates at 1 MB x 3 files. Every logged object passes
 * through `redact` so a token, a password or an answer can never reach disk, whatever the caller does.
 */
import type { FsPort } from './electron/types';

export const REDACTED = '[redacted]';

const SENSITIVE_KEYS: ReadonlySet<string> = new Set(
  [
    'authorization',
    'accesstoken',
    'refreshtoken',
    'password',
    'answers',
    'selectedindex',
    'optionindex',
    'blob',
  ].map((k) => k.toLowerCase()),
);

const MAX_DEPTH = 6;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redact(value.message) };
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') {
    // A bearer header or a JWT that slipped into free text.
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
      .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, REDACTED);
  }
  return value;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(event: string, data?: Record<string, unknown>): void;
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
  /** Resolves when every queued line has been written (used before the process exits). */
  flush?(): Promise<void>;
}

export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export const LOG_MAX_BYTES = 1024 * 1024;
export const LOG_FILES = 3;

export function createFileLogger(deps: {
  fs: FsPort;
  dir: string;
  now?: () => Date;
  onError?: (e: unknown) => void;
}): Logger {
  const { fs, dir } = deps;
  const now = deps.now ?? (() => new Date());
  const file = `${dir}/main.log`;
  let chain: Promise<void> = Promise.resolve();

  async function rotate(): Promise<void> {
    const size = await fs.fileSize(file).catch(() => 0);
    if (size < LOG_MAX_BYTES) return;
    for (let i = LOG_FILES - 1; i >= 1; i--) {
      const from = i === 1 ? file : `${file}.${String(i - 1)}`;
      await fs.rename(from, `${file}.${String(i)}`).catch(() => undefined);
    }
  }

  function write(level: LogLevel, event: string, data?: Record<string, unknown>): void {
    const line = `${JSON.stringify({
      t: now().toISOString(),
      level,
      event,
      ...(data ? { data: redact(data) } : {}),
    })}\n`;
    chain = chain
      .then(async () => {
        await fs.mkdir(dir);
        await rotate();
        await fs.appendFile(file, line);
      })
      .catch((e: unknown) => {
        deps.onError?.(e);
      });
  }

  return {
    flush: () => chain,
    debug: (e, d) => {
      write('debug', e, d);
    },
    info: (e, d) => {
      write('info', e, d);
    },
    warn: (e, d) => {
      write('warn', e, d);
    },
    error: (e, d) => {
      write('error', e, d);
    },
  };
}
