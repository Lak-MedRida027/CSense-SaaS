/**
 * True when every UTF-16 surrogate is part of a valid pair. (Not `String.prototype.isWellFormed`,
 * which this shared package's TypeScript target does not declare.) A lone surrogate cannot survive
 * a database or JSON round trip, so it must never reach a hashed audit entry.
 */
export function isWellFormedString(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/**
 * Free text typed by an administrator (notes, references): no control characters other than
 * newline and tab (log injection, display tricks) and no lone surrogates.
 */
export function isCleanText(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0x0a || code === 0x09) continue;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return isWellFormedString(value);
}
