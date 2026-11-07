import { randomInt } from 'node:crypto';

export type Shuffle = <T>(items: readonly T[]) => T[];

/** Fisher-Yates with a CSPRNG, so the served order is not predictable. Returns a copy. */
export const secureShuffle: Shuffle = <T>(items: readonly T[]): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
};
