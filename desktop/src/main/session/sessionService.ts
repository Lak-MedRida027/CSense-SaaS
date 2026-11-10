/**
 * Session service (plan 5, ADR 0014): sign-in, silent resume of a persisted session, sign-out, and
 * the `SessionView` the renderer is allowed to see. Tokens never appear in any view.
 */
import type { Result, SessionUserView, SessionView } from '../../shared/ipcChannels';
import { ApiClient, type ApiResult, type SessionEndReason } from '../api/client';
import { OPERATIONS, type UserResponse } from '../api/operations';
import type { Logger } from '../log';
import type { TokenStore } from './tokenStore';

export type SessionChange = 'signed_in' | 'signed_out' | 'ended';
export type RestoreOutcome = 'signed_in' | 'signed_out' | 'network_error';

export function toResult<T>(r: ApiResult<T>): Result<T> {
  if (r.ok) return { ok: true, data: r.data };
  const { status: _status, ...error } = r.error;
  return { ok: false, error };
}

function toUserView(u: UserResponse): SessionUserView {
  return {
    id: u.id,
    name: u.name,
    role: u.role,
    ...(u.level !== undefined ? { level: u.level } : {}),
    ...(u.totalXP !== undefined ? { totalXP: u.totalXP } : {}),
  };
}

export class SessionService {
  private user: SessionUserView | null = null;
  private status: SessionView['status'] = 'unknown';
  private notice: SessionView['endedNotice'] | undefined;
  private readonly listeners = new Set<(c: SessionChange) => void>();

  constructor(
    private readonly deps: {
      api: ApiClient;
      tokens: TokenStore;
      log: Logger;
      emit: (view: SessionView) => void;
    },
  ) {}

  getView(): SessionView {
    return {
      status: this.status,
      persistence: this.deps.tokens.persistence,
      ...(this.user ? { user: this.user } : {}),
      ...(this.notice ? { endedNotice: this.notice } : {}),
    };
  }

  getUser(): SessionUserView | null {
    return this.user;
  }

  onChange(listener: (c: SessionChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Server told us the session is gone (revoked, deactivated, refresh rejected). */
  handleEnded(_reason: SessionEndReason): void {
    this.user = null;
    this.status = 'signed_out';
    this.notice = 'session_ended';
    this.publish('ended');
  }

  /** Silent resume at start-up (D5-13). `network_error` leaves the status `unknown`. */
  async restore(): Promise<RestoreOutcome> {
    const { api, tokens, log } = this.deps;
    if (!tokens.getRefresh()) {
      const stored = await tokens.load();
      if (!stored) return this.settleSignedOut();
    }
    const outcome = await api.refresh();
    if (outcome === 'ended') return 'signed_out'; // handleEnded already published
    if (outcome === 'network') {
      log.info('session.restore_offline');
      return 'network_error';
    }
    const me = await api.call(OPERATIONS['auth.me']);
    if (!me.ok) {
      if (me.error.code === 'NETWORK_UNAVAILABLE' || me.error.code === 'INTERNAL_ERROR') {
        return 'network_error';
      }
      if (me.error.code === 'NOT_SIGNED_IN') return 'signed_out';
      log.warn('session.restore_me_failed', { code: me.error.code });
      await api.discardSession();
      return this.settleSignedOut();
    }
    this.user = toUserView(me.data);
    this.status = 'signed_in';
    this.notice = undefined;
    this.publish('signed_in');
    return 'signed_in';
  }

  async login(input: { email: string; password: string }): Promise<Result<SessionView>> {
    const { api, tokens } = this.deps;
    const res = await api.call(OPERATIONS['auth.login'], { body: input });
    if (!res.ok) return toResult(res);
    const t = res.data;
    const refreshExpiresAt = Date.parse(t.refreshTokenExpiresAt);
    if (Number.isNaN(refreshExpiresAt)) {
      return { ok: false, error: { code: 'BAD_RESPONSE', message: 'Unexpected response.' } };
    }
    await tokens.set({
      userId: t.user.id,
      accessToken: t.accessToken,
      accessExpiresAt: Date.now() + t.accessTokenExpiresIn * 1000,
      refreshToken: t.refreshToken,
      refreshExpiresAt,
    });
    api.noteAuthenticated();
    this.user = toUserView(t.user);
    this.status = 'signed_in';
    this.notice = undefined;
    this.publish('signed_in');
    return { ok: true, data: this.getView() };
  }

  /**
   * Best-effort server logout (5 s), then wipe memory and file regardless of the network result.
   * The caller exits any active lockdown first.
   */
  async logout(): Promise<Result<void>> {
    const { api } = this.deps;
    if (this.deps.tokens.getRefresh()) {
      await api.call(OPERATIONS['auth.logout']).catch(() => undefined);
    }
    await api.discardSession();
    this.user = null;
    this.status = 'signed_out';
    this.notice = undefined;
    this.publish('signed_out');
    return { ok: true, data: undefined };
  }

  private settleSignedOut(): RestoreOutcome {
    this.user = null;
    this.status = 'signed_out';
    this.publish('signed_out');
    return 'signed_out';
  }

  private publish(change: SessionChange): void {
    this.deps.emit(this.getView());
    for (const l of [...this.listeners]) l(change);
  }
}
