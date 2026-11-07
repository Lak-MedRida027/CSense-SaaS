import { beforeAll, describe, expect, it } from 'vitest';
import {
  getRounds,
  hashPassword,
  initDummyHash,
  needsRehash,
  verifyAgainstDummy,
  verifyPassword,
} from '../src/features/auth/password.js';
import { randomPassword } from './helpers/fixtures.js';

const password = randomPassword();
let hash12: string;

beforeAll(async () => {
  hash12 = await hashPassword(password, 12);
  await initDummyHash(12);
});

describe('password hashing', () => {
  it('P1: the hash uses the configured cost and it is at least 12', () => {
    expect(getRounds(hash12)).toBe(12);
    expect(getRounds(hash12)).toBeGreaterThanOrEqual(12);
  });

  it('P2: hashPassword refuses a cost below 12', async () => {
    await expect(hashPassword(password, 11)).rejects.toThrow(/cost/);
    await expect(hashPassword(password, 4)).rejects.toThrow(/cost/);
    await expect(hashPassword(password, 12.5)).rejects.toThrow(/cost/);
  });

  it('P3: verify returns true for the right password and false otherwise', async () => {
    expect(await verifyPassword(password, hash12)).toBe(true);
    expect(await verifyPassword(`${password}x`, hash12)).toBe(false);
    expect(await verifyAgainstDummy(password)).toBe(false);
  });

  it('P4: needsRehash reports lower-cost and malformed hashes', () => {
    expect(needsRehash(hash12, 12)).toBe(false);
    expect(needsRehash(hash12, 13)).toBe(true);
    expect(needsRehash('not-a-bcrypt-hash', 12)).toBe(true);
  });

  it('P5: a password over 72 bytes verifies as false without throwing', async () => {
    const long = 'x'.repeat(100);
    expect(await verifyPassword(long, hash12)).toBe(false);
    await expect(hashPassword(long, 12)).rejects.toThrow(/72/);
    // 40 two-byte characters: 80 bytes.
    expect(await verifyPassword('é'.repeat(40), hash12)).toBe(false);
  });
});
