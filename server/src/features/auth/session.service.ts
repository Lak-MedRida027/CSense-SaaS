import { Types, trusted } from 'mongoose';
import type { AppConfig } from '../../config/appConfig.js';
import { AuthSession, type AuthSessionRevokeReason } from '../../models/index.js';
import { generateRefreshToken, hashInList, hashRefreshToken, parseRefreshToken } from './tokens.js';

export interface SessionDeps {
  config: Pick<AppConfig, 'refreshTokenSecret' | 'refreshTtlSeconds'>;
  clock: () => Date;
}

const PREVIOUS_HASH_CAP = 50;

export interface NewSession {
  sessionId: string;
  refreshToken: string;
  expiresAt: Date;
}

/** Start a new refresh-token family at login. The expiry is absolute and never extended. */
export async function createSession(
  deps: SessionDeps,
  input: { userId: string; ip?: string | undefined; userAgent?: string | undefined },
): Promise<NewSession> {
  const now = deps.clock();
  const sessionId = new Types.ObjectId();
  const refreshToken = generateRefreshToken(sessionId.toHexString());
  const expiresAt = new Date(now.getTime() + deps.config.refreshTtlSeconds * 1000);
  await AuthSession.create({
    _id: sessionId,
    userId: new Types.ObjectId(input.userId),
    currentTokenHash: hashRefreshToken(deps.config.refreshTokenSecret, refreshToken),
    previousTokenHashes: [],
    expiresAt,
    ...(input.ip === undefined ? {} : { ip: input.ip.slice(0, 64) }),
    ...(input.userAgent === undefined ? {} : { userAgent: input.userAgent.slice(0, 256) }),
  });
  return { sessionId: sessionId.toHexString(), refreshToken, expiresAt };
}

export type RotateResult =
  | { kind: 'rotated'; sessionId: string; userId: string; refreshToken: string; expiresAt: Date }
  | { kind: 'reuse_detected'; sessionId: string; userId: string }
  | { kind: 'invalid' };

/**
 * Rotate on use. The swap is a single atomic conditional update, so exactly one of two concurrent
 * requests with the same token can win; the other looks like reuse and kills the family (D-4).
 */
export async function rotateSession(deps: SessionDeps, presented: string): Promise<RotateResult> {
  const parsed = parseRefreshToken(presented);
  if (!parsed) return { kind: 'invalid' };
  const now = deps.clock();
  const presentedHash = hashRefreshToken(deps.config.refreshTokenSecret, presented);
  const next = generateRefreshToken(parsed.sessionId);
  const nextHash = hashRefreshToken(deps.config.refreshTokenSecret, next);

  const rotated = await AuthSession.findOneAndUpdate(
    {
      _id: parsed.sessionId,
      currentTokenHash: presentedHash,
      revokedAt: null,
      expiresAt: trusted({ $gt: now }),
    },
    {
      $set: { currentTokenHash: nextHash, rotatedAt: now },
      $inc: { rotationCount: 1 },
      $push: { previousTokenHashes: { $each: [presentedHash], $slice: -PREVIOUS_HASH_CAP } },
    },
    { returnDocument: 'after' },
  ).select('userId expiresAt');

  if (rotated) {
    return {
      kind: 'rotated',
      sessionId: parsed.sessionId,
      userId: rotated.userId.toHexString(),
      refreshToken: next,
      expiresAt: rotated.expiresAt,
    };
  }

  // Not rotated: distinguish reuse of a spent token from everything else.
  const session = await AuthSession.findById(parsed.sessionId).select(
    '+previousTokenHashes userId revokedAt expiresAt',
  );
  if (
    session &&
    session.revokedAt === null &&
    session.expiresAt.getTime() > now.getTime() &&
    hashInList(presentedHash, session.previousTokenHashes)
  ) {
    await revokeSession(deps, parsed.sessionId, 'reuse_detected');
    return {
      kind: 'reuse_detected',
      sessionId: parsed.sessionId,
      userId: session.userId.toHexString(),
    };
  }
  return { kind: 'invalid' };
}

/** Idempotent: only an un-revoked session is touched. Returns whether a change was made. */
export async function revokeSession(
  deps: Pick<SessionDeps, 'clock'>,
  sessionId: string,
  reason: AuthSessionRevokeReason,
): Promise<boolean> {
  const result = await AuthSession.updateOne(
    { _id: sessionId, revokedAt: null },
    { $set: { revokedAt: deps.clock(), revokedReason: reason } },
  );
  return result.modifiedCount === 1;
}

export async function revokeAllForUser(
  deps: Pick<SessionDeps, 'clock'>,
  userId: string,
  reason: AuthSessionRevokeReason,
): Promise<number> {
  const result = await AuthSession.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: deps.clock(), revokedReason: reason } },
  );
  return result.modifiedCount;
}

export type LogoutResult =
  { kind: 'revoked'; sessionId: string; userId: string; reuse: boolean } | { kind: 'noop' };

/**
 * Revoke the session a refresh token belongs to, if the token matches. A spent (previous) token is
 * treated as reuse, mirroring rotateSession: the session is revoked with reason `reuse_detected`.
 */
export async function revokeByRefreshToken(
  deps: SessionDeps,
  presented: string,
): Promise<LogoutResult> {
  const parsed = parseRefreshToken(presented);
  if (!parsed) return { kind: 'noop' };
  const hash = hashRefreshToken(deps.config.refreshTokenSecret, presented);
  const session = await AuthSession.findById(parsed.sessionId).select(
    '+currentTokenHash +previousTokenHashes userId revokedAt',
  );
  if (!session) return { kind: 'noop' };
  const isCurrent = hashInList(hash, [session.currentTokenHash]);
  const reuse = !isCurrent && hashInList(hash, session.previousTokenHashes);
  if (!isCurrent && !reuse) return { kind: 'noop' };
  const changed = await revokeSession(deps, parsed.sessionId, reuse ? 'reuse_detected' : 'logout');
  return changed
    ? { kind: 'revoked', sessionId: parsed.sessionId, userId: session.userId.toHexString(), reuse }
    : { kind: 'noop' };
}

/** True when the session exists, belongs to `userId`, is not revoked and has not expired. */
export async function isSessionActive(
  deps: Pick<SessionDeps, 'clock'>,
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const session = await AuthSession.findById(sessionId).select('userId revokedAt expiresAt').lean();
  return (
    session !== null &&
    session.revokedAt === null &&
    session.expiresAt.getTime() > deps.clock().getTime() &&
    session.userId.toHexString() === userId
  );
}
