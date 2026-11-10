/**
 * Main-process API client (plan 5.2, ADR 0014). The only code that talks to the server.
 *
 * - Operations come from a closed table; the renderer never names a path.
 * - The bearer token is attached from memory; nothing token-shaped is ever returned to callers.
 * - Refresh is single-flight: any number of concurrent 401s cause exactly one refresh.
 * - The rotated refresh token is persisted before the refresh promise resolves.
 */
import { ERROR_CODES, type ErrorCode } from '@csense/shared';
import type { z } from 'zod';
import type { DesktopError } from '../../shared/ipcChannels';
import type { FetchPort } from '../electron/types';
import type { Logger } from '../log';
import type { TokenStore } from '../session/tokenStore';
import { OPERATIONS, type Operation } from './operations';

export type ApiError = DesktopError & { status?: number };
export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; error: ApiError };

export const MAX_REQUEST_BYTES = 64 * 1024;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** Refresh when the access token has less than this left. */
export const REFRESH_SKEW_MS = 60_000;
/** While a quiz is locked down, refresh this long before expiry (ADR 0007). */
export const PROACTIVE_LEAD_MS = 120_000;

export type SessionEndReason = 'refresh_rejected' | 'unauthenticated';

export interface ApiClientDeps {
  baseUrl: string;
  fetch: FetchPort;
  tokens: TokenStore;
  log: Logger;
  now?: () => number;
  /** Called once when the session is gone (revoked, expired). Tokens are already wiped. */
  onSessionEnded: (reason: SessionEndReason) => void;
}

type RefreshOutcome = 'ok' | 'network' | 'ended';

interface RawResponse {
  status: number;
  text: string;
  retryAfter: number | undefined;
}

type CallInput<O extends Operation> = {
  params?: z.input<O['params']>;
  body?: z.input<O['body']>;
};

const KNOWN_CODES: ReadonlySet<string> = new Set<string>(ERROR_CODES);

function fail(
  code: ApiError['code'],
  message: string,
  extra?: Partial<ApiError>,
): ApiResult<never> {
  return { ok: false, error: { code, message, ...extra } };
}

export class ApiClient {
  private refreshPromise: Promise<RefreshOutcome> | null = null;
  private generation = 0;
  private proactive = false;
  private proactiveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: ApiClientDeps) {
    this.now = deps.now ?? Date.now;
  }

  async call<O extends Operation>(
    op: O,
    input: CallInput<O> = {},
  ): Promise<ApiResult<z.output<O['response']>>> {
    const params = op.params.safeParse(input.params ?? {});
    if (!params.success) return fail('INVALID_INPUT', 'Invalid request.');
    let bodyText: string | undefined;
    if (op.auth === 'refresh') {
      const rt = this.deps.tokens.getRefresh();
      if (!rt) return fail('NOT_SIGNED_IN', 'Not signed in.');
      bodyText = JSON.stringify({ refreshToken: rt.refreshToken });
    } else if (input.body !== undefined) {
      const body = op.body.safeParse(input.body);
      if (!body.success) return fail('INVALID_INPUT', 'Invalid request.');
      bodyText = JSON.stringify(body.data);
    }
    if (bodyText !== undefined && new TextEncoder().encode(bodyText).length > MAX_REQUEST_BYTES) {
      return fail('INVALID_INPUT', 'Request too large.');
    }
    const path = op.path(params.data);

    if (op.auth !== 'bearer') {
      const raw = await this.send(op, path, bodyText, null);
      return this.finish(op, raw);
    }

    const preflight = await this.ensureAccess();
    if (!preflight.ok) return preflight.result;

    const gen = this.generation;
    let raw = await this.send(op, path, bodyText, preflight.token);
    if (raw === 'network') return fail('NETWORK_UNAVAILABLE', 'Cannot reach the server.');

    if (raw.status === 401 && this.errorCode(raw) === 'UNAUTHENTICATED') {
      // A refresh that finished after this request was sent already fixed the token: just retry.
      let outcome: RefreshOutcome = 'ok';
      if (this.generation === gen) outcome = await this.refresh();
      if (outcome === 'network') return fail('NETWORK_UNAVAILABLE', 'Cannot reach the server.');
      if (outcome === 'ended') return fail('NOT_SIGNED_IN', 'Your session has ended.');
      const token = this.deps.tokens.getAccess()?.token;
      if (!token) return fail('NOT_SIGNED_IN', 'Your session has ended.');
      raw = await this.send(op, path, bodyText, token);
      if (raw === 'network') return fail('NETWORK_UNAVAILABLE', 'Cannot reach the server.');
      if (raw.status === 401) {
        await this.endSession('unauthenticated');
        return fail('NOT_SIGNED_IN', 'Your session has ended.');
      }
    }
    return this.finish(op, raw);
  }

  /** Start or stop the lockdown-time refresh timer (ADR 0007: a quiz outlives the access token). */
  armProactiveRefresh(enabled: boolean): void {
    this.proactive = enabled;
    this.schedule(enabled ? undefined : null);
  }

  private schedule(delayOverride?: number | null): void {
    if (this.proactiveTimer) clearTimeout(this.proactiveTimer);
    this.proactiveTimer = null;
    if (!this.proactive || delayOverride === null) return;
    const access = this.deps.tokens.getAccess();
    const delay =
      delayOverride ??
      (access ? Math.max(access.expiresAt - PROACTIVE_LEAD_MS - this.now(), 1000) : 15_000);
    this.proactiveTimer = setTimeout(() => {
      this.proactiveTimer = null;
      void this.refresh().then((outcome) => {
        if (outcome === 'ended') return;
        this.schedule(outcome === 'network' ? 15_000 : undefined);
      });
    }, delay);
  }

  /** Single-flight refresh. Every concurrent caller awaits the same promise. */
  refresh(): Promise<RefreshOutcome> {
    if (this.refreshPromise) return this.refreshPromise;
    const p = this.doRefresh().finally(() => {
      this.refreshPromise = null;
    });
    this.refreshPromise = p;
    return p;
  }

  private async doRefresh(): Promise<RefreshOutcome> {
    const { tokens, log } = this.deps;
    const rt = tokens.getRefresh();
    if (!rt) return 'ended';
    const op = OPERATIONS['auth.refresh'];
    const raw = await this.send(
      op,
      op.path({}),
      JSON.stringify({ refreshToken: rt.refreshToken }),
      null,
    );
    if (raw === 'network') return 'network';
    if (raw.status === 401 || this.errorCode(raw) === 'INVALID_REFRESH_TOKEN') {
      log.info('session.refresh_rejected');
      await this.endSession('refresh_rejected');
      return 'ended';
    }
    const parsed = this.parseSuccess(op, raw);
    if (!parsed.ok) return 'network';
    const t = parsed.data;
    const refreshExpiresAt = Date.parse(t.refreshTokenExpiresAt);
    if (Number.isNaN(refreshExpiresAt)) return 'network';
    // Persist BEFORE resolving: a crash after server rotation but before this write would present the
    // spent token at the next launch (reuse detection, user signs in again), which is the secure outcome.
    await tokens.set({
      userId: rt.userId,
      accessToken: t.accessToken,
      accessExpiresAt: this.now() + t.accessTokenExpiresIn * 1000,
      refreshToken: t.refreshToken,
      refreshExpiresAt,
    });
    this.generation++;
    return 'ok';
  }

  /** Called after a successful login so the proactive timer and generation track the new tokens. */
  noteAuthenticated(): void {
    this.generation++;
    if (this.proactive) this.schedule();
  }

  async endSession(reason: SessionEndReason): Promise<void> {
    const { tokens } = this.deps;
    const had = tokens.getAccess() !== null || tokens.getRefresh() !== null;
    this.schedule(null);
    await tokens.clear();
    this.generation++;
    if (had) this.deps.onSessionEnded(reason);
  }

  /** Voluntary sign-out: wipe tokens and timers without raising a "session ended" event. */
  async discardSession(): Promise<void> {
    this.schedule(null);
    this.proactive = false;
    await this.deps.tokens.clear();
    this.generation++;
  }

  private async ensureAccess(): Promise<
    { ok: true; token: string } | { ok: false; result: ApiResult<never> }
  > {
    const { tokens } = this.deps;
    let access = tokens.getAccess();
    if (!access || access.expiresAt - this.now() < REFRESH_SKEW_MS) {
      if (!access && !tokens.getRefresh()) {
        return { ok: false, result: fail('NOT_SIGNED_IN', 'Not signed in.') };
      }
      const outcome = await this.refresh();
      access = tokens.getAccess();
      if (outcome === 'ended' || (!access && outcome !== 'network')) {
        return { ok: false, result: fail('NOT_SIGNED_IN', 'Your session has ended.') };
      }
      if (!access || access.expiresAt <= this.now()) {
        return { ok: false, result: fail('NETWORK_UNAVAILABLE', 'Cannot reach the server.') };
      }
    }
    return { ok: true, token: access.token };
  }

  private async send(
    op: Operation,
    path: string,
    body: string | undefined,
    bearer: string | null,
  ): Promise<RawResponse | 'network'> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, op.timeoutMs);
    try {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (bearer) headers.authorization = `Bearer ${bearer}`;
      const res = await this.deps.fetch(`${this.deps.baseUrl}${path}`, {
        method: op.method,
        headers,
        ...(body !== undefined ? { body } : {}),
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
      });
      const text = await readCapped(res, MAX_RESPONSE_BYTES);
      if (text === null) return 'network';
      const ra = Number(res.headers.get('retry-after'));
      return {
        status: res.status,
        text,
        retryAfter: Number.isFinite(ra) && ra > 0 ? ra : undefined,
      };
    } catch {
      return 'network';
    } finally {
      clearTimeout(timer);
    }
  }

  private errorCode(raw: RawResponse): string | undefined {
    try {
      const j = JSON.parse(raw.text) as { error?: { code?: unknown } };
      return typeof j.error?.code === 'string' ? j.error.code : undefined;
    } catch {
      return undefined;
    }
  }

  private parseSuccess<O extends Operation>(
    op: O,
    raw: RawResponse,
  ): { ok: true; data: z.output<O['response']> } | { ok: false } {
    let json: unknown;
    if (raw.text === '') json = undefined;
    else {
      try {
        json = JSON.parse(raw.text);
      } catch {
        this.deps.log.warn('api.bad_response', { op: op.id, reason: 'not_json' });
        return { ok: false };
      }
    }
    const parsed = op.response.safeParse(json);
    if (!parsed.success) {
      // Paths only, never values (a response could carry anything).
      this.deps.log.warn('api.bad_response', {
        op: op.id,
        paths: parsed.error.issues.slice(0, 5).map((i) => i.path.join('.')),
      });
      return { ok: false };
    }
    return { ok: true, data: parsed.data as z.output<O['response']> };
  }

  private finish<O extends Operation>(
    op: O,
    raw: RawResponse | 'network',
  ): ApiResult<z.output<O['response']>> {
    if (raw === 'network') return fail('NETWORK_UNAVAILABLE', 'Cannot reach the server.');
    if (op.success.includes(raw.status)) {
      const parsed = this.parseSuccess(op, raw);
      if (!parsed.ok) return fail('BAD_RESPONSE', 'Unexpected response from the server.');
      return { ok: true, status: raw.status, data: parsed.data };
    }
    return this.toError(raw);
  }

  private toError(raw: RawResponse): ApiResult<never> {
    let code: ErrorCode = 'INTERNAL_ERROR';
    let message = 'Request failed.';
    let retryAt: string | undefined;
    try {
      const j = JSON.parse(raw.text) as {
        error?: { code?: unknown; message?: unknown; details?: { retryAt?: unknown } };
      };
      if (typeof j.error?.code === 'string' && KNOWN_CODES.has(j.error.code)) {
        code = j.error.code as ErrorCode;
      }
      if (typeof j.error?.message === 'string') message = j.error.message.slice(0, 300);
      if (typeof j.error?.details?.retryAt === 'string') retryAt = j.error.details.retryAt;
    } catch {
      // Non-JSON error body (proxy page): keep the generic error.
    }
    // 5xx without a known envelope is a server-side outage, not a client error.
    if (raw.status >= 500 && code === 'INTERNAL_ERROR') {
      return fail(raw.status === 503 ? 'NETWORK_UNAVAILABLE' : 'INTERNAL_ERROR', message, {
        status: raw.status,
      });
    }
    return {
      ok: false,
      error: {
        code,
        message,
        status: raw.status,
        ...(raw.retryAfter !== undefined ? { retryAfterSeconds: raw.retryAfter } : {}),
        ...(retryAt !== undefined ? { details: { retryAt } } : {}),
      },
    };
  }
}

async function readCapped(res: Response, max: number): Promise<string | null> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!res.body) {
    const t = await res.text();
    return t.length > max ? null : t;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
