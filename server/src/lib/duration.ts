const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86_400 } as const;

/** Parse "15m", "7d", "30s", "2h" into seconds. Throws on anything else. */
export function parseDuration(input: string): number {
  const match = /^(\d+)([smhd])$/.exec(input);
  if (!match) throw new Error('invalid duration');
  const seconds = Number(match[1]) * UNIT_SECONDS[match[2] as keyof typeof UNIT_SECONDS];
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new Error('invalid duration');
  return seconds;
}

export function isDuration(input: string): boolean {
  try {
    parseDuration(input);
    return true;
  } catch {
    return false;
  }
}
