import type { AuthContext, LoginResponse, TokenResponse } from '@csense/shared';
import type { AppConfig } from '../../config/appConfig.js';
import { invalidCredentials, invalidRefreshToken, unauthenticated } from '../../lib/httpError.js';
import { User } from '../../models/index.js';
import { audit, type AuditContext } from '../audit/audit.service.js';
import { toUserDTO } from '../users/user.mapper.js';
import {
  enforceFailedLoginFloor,
  FailedLoginFloor,
  realTiming,
  type Timing,
} from './failedLoginDelay.js';
import { hashPassword, needsRehash, verifyAgainstDummy, verifyPassword } from './password.js';
import {
  createSession,
  isSessionActive,
  revokeByRefreshToken,
  revokeSession,
  rotateSession,
  type SessionDeps,
} from './session.service.js';
import { parseBearer, signAccessToken, verifyAccessToken } from './tokens.js';

export interface AuthDeps extends SessionDeps {
  config: AppConfig;
  /** Injectable timing so the failed-login floor is testable without real waiting. */
  timing?: Timing;
  /** Effective failure floor (calibrated and adaptive). Defaults to the configured fixed floor. */
  floor?: FailedLoginFloor;
  /**
   * Called synchronously the moment a credentials failure is decided, before the floor sleep and
   * the response, so a dropped connection cannot hide it (P2-L7). Must not throw or block.
   */
  onCredentialsFailure?: (email: string) => void;
}

type RequestMeta = AuditContext;

/** Resolve an Authorization header into an AuthContext, or null (the gate maps null to 401). */
export async function authenticateBearer(
  deps: AuthDeps,
  header: string | undefined,
): Promise<AuthContext | null> {
  const token = parseBearer(header);
  if (token === null) return null;
  const now = deps.clock();
  const claims = await verifyAccessToken(deps.config, token, now);
  if (claims === null) return null;

  // D-5: the database is the source of truth for activity, role and session on every request.
  const user = await User.findById(claims.sub).select('role isActive').lean();
  if (!user || !user.isActive || user.role !== claims.role) return null;
  if (!(await isSessionActive(deps, claims.sid, claims.sub))) return null;
  return { userId: claims.sub, role: user.role, sessionId: claims.sid };
}

function tokenResponse(
  deps: AuthDeps,
  accessToken: string,
  refreshToken: string,
  refreshExpiresAt: Date,
): TokenResponse {
  return {
    tokenType: 'Bearer',
    accessToken,
    accessTokenExpiresIn: deps.config.accessTtlSeconds,
    refreshToken,
    refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
  };
}

export async function login(
  deps: AuthDeps,
  input: { email: string; password: string },
  meta: RequestMeta,
): Promise<LoginResponse> {
  const timing = deps.timing ?? realTiming;
  const startedAt = timing.now();
  const user = await User.findOne({ email: input.email }).select('+passwordHash');

  // Exactly one bcrypt compare in every branch, so timing does not reveal whether the account exists.
  let passwordOk = false;
  if (user) {
    passwordOk = await verifyPassword(input.password, user.passwordHash);
  } else {
    await verifyAgainstDummy(input.password);
  }

  if (!user || !passwordOk || !user.isActive) {
    // Never store the email typed for an unknown account (D-11).
    deps.onCredentialsFailure?.(input.email);
    const reason = !user ? 'unknown_account' : !passwordOk ? 'bad_credentials' : 'inactive';
    await audit.record({
      action: 'auth.login.failed',
      outcome: 'failure',
      severity: 'warning',
      target: user ? { type: 'user', id: user.id } : null,
      ctx: meta,
      metadata: { reason },
    });
    // Same floor for every failure branch; successful logins are never delayed.
    const floor = (deps.floor ??= new FailedLoginFloor(deps.config.failedLoginMinMs));
    const floorMs = floor.effectiveMs;
    floor.record(timing.now() - startedAt);
    await enforceFailedLoginFloor(timing, startedAt, floorMs);
    throw invalidCredentials();
  }

  if (needsRehash(user.passwordHash, deps.config.bcryptCost)) {
    user.passwordHash = await hashPassword(input.password, deps.config.bcryptCost);
    await user.save();
  }

  const userId = user.id;
  const session = await createSession(deps, {
    userId,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  try {
    await audit.record({
      action: 'auth.login.succeeded',
      outcome: 'success',
      actor: { id: userId, role: user.role },
      target: { type: 'session', id: session.sessionId },
      ctx: meta,
    });
  } catch (err) {
    // Fail closed: no usable session without its audit entry.
    await revokeSession(deps, session.sessionId, 'admin_revoked');
    throw err;
  }

  const accessToken = await signAccessToken(
    deps.config,
    { userId, role: user.role, sessionId: session.sessionId },
    deps.clock(),
  );
  return {
    ...tokenResponse(deps, accessToken, session.refreshToken, session.expiresAt),
    user: toUserDTO(user),
  };
}

export async function refresh(
  deps: AuthDeps,
  presented: string,
  meta: RequestMeta,
): Promise<TokenResponse> {
  const result = await rotateSession(deps, presented);

  if (result.kind === 'reuse_detected') {
    await audit.record({
      action: 'auth.refresh.reuse_detected',
      outcome: 'failure',
      severity: 'critical',
      actor: null,
      target: { type: 'session', id: result.sessionId },
      ctx: meta,
      metadata: { userId: result.userId },
    });
    throw invalidRefreshToken();
  }
  if (result.kind === 'invalid') throw invalidRefreshToken();

  const user = await User.findById(result.userId).select('role isActive').lean();
  if (!user?.isActive) {
    await revokeSession(deps, result.sessionId, 'user_inactive');
    await audit.record({
      action: 'auth.refresh.denied',
      outcome: 'failure',
      severity: 'warning',
      target: { type: 'session', id: result.sessionId },
      ctx: meta,
      metadata: { reason: 'user_inactive', userId: result.userId },
    });
    throw invalidRefreshToken();
  }

  // The role comes from the database, never from the previous token.
  const accessToken = await signAccessToken(
    deps.config,
    { userId: result.userId, role: user.role, sessionId: result.sessionId },
    deps.clock(),
  );
  return tokenResponse(deps, accessToken, result.refreshToken, result.expiresAt);
}

/** Idempotent. The caller always answers 204, whatever happened here. */
export async function logout(deps: AuthDeps, presented: string, meta: RequestMeta): Promise<void> {
  const result = await revokeByRefreshToken(deps, presented);
  if (result.kind !== 'revoked') return;
  if (result.reuse) {
    // A spent token presented at logout is a replay, exactly as at /auth/refresh (P2-L2).
    await audit.record({
      action: 'auth.refresh.reuse_detected',
      outcome: 'failure',
      severity: 'critical',
      actor: null,
      target: { type: 'session', id: result.sessionId },
      ctx: meta,
      metadata: { userId: result.userId, via: 'logout' },
    });
    return;
  }
  const user = await User.findById(result.userId).select('role').lean();
  await audit.record({
    action: 'auth.logout',
    outcome: 'success',
    actor: user ? { id: result.userId, role: user.role } : null,
    target: { type: 'session', id: result.sessionId },
    ctx: meta,
  });
}

export async function getCurrentUser(userId: string) {
  const user = await User.findById(userId);
  if (!user) throw unauthenticated();
  return toUserDTO(user);
}
