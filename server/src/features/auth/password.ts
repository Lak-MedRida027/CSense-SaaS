import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { BCRYPT_MIN_COST, PASSWORD_MAX_BYTES } from '@csense/shared';

/**
 * The only module that imports `bcrypt` (ADR 0004). Swapping to `bcryptjs` is a change in this file.
 */
let dummyHash: string | undefined;

function assertCost(cost: number): void {
  if (!Number.isInteger(cost) || cost < BCRYPT_MIN_COST) {
    throw new Error(`bcrypt cost must be an integer >= ${String(BCRYPT_MIN_COST)}`);
  }
}

const tooLong = (password: string): boolean =>
  Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES;

export async function hashPassword(password: string, cost: number): Promise<string> {
  assertCost(cost);
  if (tooLong(password)) throw new Error('password exceeds the bcrypt 72-byte limit');
  return bcrypt.hash(password, cost);
}

/** Pre-compute the dummy hash used to equalise timing for unknown accounts. */
export async function initDummyHash(cost: number): Promise<void> {
  assertCost(cost);
  dummyHash = await bcrypt.hash(randomBytes(32).toString('base64url'), cost);
}

/** Returns false (never throws) for over-long input; it still burns one compare for timing parity. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (tooLong(password)) {
    await verifyAgainstDummy(password);
    return false;
  }
  return bcrypt.compare(password, hash);
}

/** One bcrypt compare against a random hash; always false. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  if (dummyHash === undefined) {
    throw new Error('initDummyHash must run before verifyAgainstDummy');
  }
  // Truncate so bcrypt never sees more than 72 bytes; result is discarded regardless.
  await bcrypt.compare(tooLong(password) ? password.slice(0, 32) : password, dummyHash);
  return false;
}

export function getRounds(hash: string): number {
  return bcrypt.getRounds(hash);
}

export function needsRehash(hash: string, cost: number): boolean {
  try {
    return bcrypt.getRounds(hash) < cost;
  } catch {
    return true;
  }
}
