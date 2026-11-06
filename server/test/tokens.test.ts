import { SignJWT, decodeJwt, decodeProtectedHeader } from 'jose';
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  generateRefreshToken,
  hashRefreshToken,
  parseBearer,
  parseRefreshToken,
  signAccessToken,
  verifyAccessToken,
  type TokenConfig,
} from '../src/features/auth/tokens.js';
import { randomSecret } from './helpers/testConfig.js';

const cfg: TokenConfig = {
  jwtAccessSecret: randomSecret(),
  refreshTokenSecret: randomSecret(),
  accessTtlSeconds: 900,
};
const ids = () => ({
  userId: new Types.ObjectId().toHexString(),
  sessionId: new Types.ObjectId().toHexString(),
});
const now = new Date('2026-11-06T09:00:00.000Z');
const enc = (s: string) => new TextEncoder().encode(s);

describe('access tokens', () => {
  it('K1: carries exactly the allowed claims, HS256, and no personal data', async () => {
    const { userId, sessionId } = ids();
    const token = await signAccessToken(cfg, { userId, role: 'employee', sessionId }, now);
    const claims = decodeJwt(token);
    expect(Object.keys(claims).sort()).toEqual(
      ['aud', 'exp', 'iat', 'iss', 'jti', 'role', 'sid', 'sub'].sort(),
    );
    expect(claims).toMatchObject({
      sub: userId,
      sid: sessionId,
      role: 'employee',
      iss: 'csense-api',
      aud: 'csense-desktop',
    });
    const header = decodeProtectedHeader(token);
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(JSON.stringify(claims)).not.toMatch(/email|name|hash|password/i);
  });

  it('K2: exp - iat equals the configured TTL', async () => {
    const token = await signAccessToken(cfg, { ...ids(), role: 'administrator' }, now);
    const { exp, iat } = decodeJwt(token);
    expect((exp ?? 0) - (iat ?? 0)).toBe(900);
  });

  it('K3: verify accepts a good token and rejects every kind of bad one', async () => {
    const { userId, sessionId } = ids();
    const good = await signAccessToken(cfg, { userId, role: 'employee', sessionId }, now);
    expect(await verifyAccessToken(cfg, good, now)).toMatchObject({ sub: userId, sid: sessionId });

    // Wrong secret.
    expect(
      await verifyAccessToken({ ...cfg, jwtAccessSecret: randomSecret() }, good, now),
    ).toBeNull();

    // alg: none.
    const [h, p] = good.split('.');
    const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
      'base64url',
    );
    expect(await verifyAccessToken(cfg, `${noneHeader}.${String(p)}.`, now)).toBeNull();
    expect(h).toBeDefined();

    // HS512 re-signed with the correct secret: algorithm is pinned to HS256.
    const base = {
      role: 'employee',
      sid: sessionId,
    };
    const sign = (alg: string, mutate: (j: SignJWT) => SignJWT, secret = cfg.jwtAccessSecret) =>
      mutate(
        new SignJWT(base)
          .setProtectedHeader({ alg, typ: 'JWT' })
          .setSubject(userId)
          .setIssuer('csense-api')
          .setAudience('csense-desktop')
          .setIssuedAt(Math.floor(now.getTime() / 1000))
          .setExpirationTime(Math.floor(now.getTime() / 1000) + 900)
          .setJti('j'),
      ).sign(enc(secret));
    const identity = (j: SignJWT) => j;

    expect(await verifyAccessToken(cfg, await sign('HS256', identity), now)).not.toBeNull();
    expect(await verifyAccessToken(cfg, await sign('HS512', identity), now)).toBeNull();

    // Tampered payload.
    const tampered = `${String(h)}.${Buffer.from(
      JSON.stringify({ ...decodeJwt(good), role: 'administrator' }),
    ).toString('base64url')}.${String(good.split('.')[2])}`;
    expect(await verifyAccessToken(cfg, tampered, now)).toBeNull();

    // Wrong issuer / audience.
    expect(
      await verifyAccessToken(cfg, await sign('HS256', (j) => j.setIssuer('evil')), now),
    ).toBeNull();
    expect(
      await verifyAccessToken(cfg, await sign('HS256', (j) => j.setAudience('evil')), now),
    ).toBeNull();

    // Expired (injected clock).
    const later = new Date(now.getTime() + 901_000);
    expect(await verifyAccessToken(cfg, good, later)).toBeNull();

    // Missing sid.
    const noSid = await new SignJWT({ role: 'employee' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer('csense-api')
      .setAudience('csense-desktop')
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(now.getTime() / 1000) + 900)
      .setJti('j')
      .sign(enc(cfg.jwtAccessSecret));
    expect(await verifyAccessToken(cfg, noSid, now)).toBeNull();

    // Role outside ROLES.
    const badRole = await new SignJWT({ role: 'superadmin', sid: sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer('csense-api')
      .setAudience('csense-desktop')
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(now.getTime() / 1000) + 900)
      .setJti('j')
      .sign(enc(cfg.jwtAccessSecret));
    expect(await verifyAccessToken(cfg, badRole, now)).toBeNull();

    // Non-ObjectId subject.
    const badSub = await sign('HS256', (j) => j.setSubject('not-an-object-id'));
    expect(await verifyAccessToken(cfg, badSub, now)).toBeNull();
  });

  it('parses only well-formed Bearer headers', () => {
    const jwt = 'aaa.bbb.ccc';
    expect(parseBearer(`Bearer ${jwt}`)).toBe(jwt);
    expect(parseBearer(undefined)).toBeNull();
    expect(parseBearer('Token aaa.bbb.ccc')).toBeNull();
    expect(parseBearer('Bearer')).toBeNull();
    expect(parseBearer('Bearer a b')).toBeNull();
    expect(parseBearer('bearer aaa.bbb.ccc')).toBeNull();
    expect(parseBearer(`Bearer ${'a'.repeat(3000)}.b.c`)).toBeNull();
  });
});

describe('refresh tokens', () => {
  it('K4: has the documented format, is unique, hashes deterministically and parses strictly', () => {
    const sid = new Types.ObjectId().toHexString();
    const a = generateRefreshToken(sid);
    const b = generateRefreshToken(sid);
    expect(a).toMatch(/^[a-f0-9]{24}\.[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(parseRefreshToken(a)).toEqual({ sessionId: sid });

    const h1 = hashRefreshToken(cfg.refreshTokenSecret, a);
    expect(h1).toBe(hashRefreshToken(cfg.refreshTokenSecret, a));
    expect(h1).not.toBe(a);
    expect(h1).not.toBe(hashRefreshToken(randomSecret(), a));
    expect(h1).toMatch(/^[a-f0-9]{64}$/);

    for (const bad of ['', 'abc', `${sid}.short`, sid, `zz${sid.slice(2)}.${'A'.repeat(43)}`]) {
      expect(parseRefreshToken(bad)).toBeNull();
    }
  });
});
