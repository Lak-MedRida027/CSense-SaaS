import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import {
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_ISSUER,
  ROLES,
  objectIdSchema,
  type AccessTokenClaims,
  type Role,
} from '@csense/shared';

export interface TokenConfig {
  jwtAccessSecret: string;
  refreshTokenSecret: string;
  accessTtlSeconds: number;
}

const MAX_BEARER_LENGTH = 2048;
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

const claimsSchema = z.object({
  sub: objectIdSchema,
  sid: objectIdSchema,
  role: z.enum(ROLES),
  jti: z.string().min(1),
  iat: z.number(),
  exp: z.number(),
  iss: z.literal(ACCESS_TOKEN_ISSUER),
  aud: z.literal(ACCESS_TOKEN_AUDIENCE),
});

const key = (secret: string): Uint8Array => new TextEncoder().encode(secret);

export async function signAccessToken(
  cfg: TokenConfig,
  input: { userId: string; role: Role; sessionId: string },
  now: Date,
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ role: input.role, sid: input.sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(input.userId)
    .setIssuer(ACCESS_TOKEN_ISSUER)
    .setAudience(ACCESS_TOKEN_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + cfg.accessTtlSeconds)
    .setJti(randomUUID())
    .sign(key(cfg.jwtAccessSecret));
}

/** Returns the validated claims, or null for ANY failure (the caller maps all to one 401). */
export async function verifyAccessToken(
  cfg: TokenConfig,
  token: string,
  now: Date,
): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(cfg.jwtAccessSecret), {
      algorithms: ['HS256'],
      issuer: ACCESS_TOKEN_ISSUER,
      audience: ACCESS_TOKEN_AUDIENCE,
      currentDate: now,
      requiredClaims: ['sub', 'iat', 'exp', 'jti'],
    });
    const parsed = claimsSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Extracts the JWT from an Authorization header value; null when absent or malformed. */
export function parseBearer(header: string | undefined): string | null {
  if (header === undefined || header.length > MAX_BEARER_LENGTH) return null;
  const match = BEARER.exec(header);
  return match?.[1] ?? null;
}

// --- Refresh tokens: opaque `<sessionId>.<32 random bytes base64url>` -----------------------------

const REFRESH_FORMAT = /^([a-f0-9]{24})\.([A-Za-z0-9_-]{43})$/;

export function generateRefreshToken(sessionId: string): string {
  return `${sessionId}.${randomBytes(32).toString('base64url')}`;
}

/** Returns the session id embedded in a refresh token, or null if the format is wrong. */
export function parseRefreshToken(token: string): { sessionId: string } | null {
  const match = REFRESH_FORMAT.exec(token);
  return match?.[1] ? { sessionId: match[1] } : null;
}

export function hashRefreshToken(secret: string, token: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

export function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

/** Constant-time membership test against a list of stored hashes. */
export function hashInList(hash: string, list: readonly string[]): boolean {
  let found = false;
  for (const candidate of list) {
    if (hashesEqual(hash, candidate)) found = true;
  }
  return found;
}
