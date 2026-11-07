import { describe, expect, it } from 'vitest';
import { isDuration, parseDuration } from '../src/lib/duration.js';

describe('parseDuration', () => {
  it('D1: parses s, m, h and d', () => {
    expect(parseDuration('30s')).toBe(30);
    expect(parseDuration('15m')).toBe(900);
    expect(parseDuration('2h')).toBe(7200);
    expect(parseDuration('7d')).toBe(604_800);
  });

  it('D2: rejects invalid input', () => {
    for (const bad of ['', '15', 'm', '-1m', '1.5h', '15x', ' 15m', '0s', '1M']) {
      expect(() => parseDuration(bad)).toThrow();
      expect(isDuration(bad)).toBe(false);
    }
  });
});
