/**
 * Integer division rounded half up, for non-negative integers: floor((2n + d) / 2d). It is the only
 * rounding the risk engine uses, so results never depend on floating point.
 */
export function roundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || numerator < 0) {
    throw new RangeError('numerator must be a non-negative integer');
  }
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError('denominator must be a positive integer');
  }
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}
