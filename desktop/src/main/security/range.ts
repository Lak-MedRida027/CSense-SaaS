/**
 * Single-range `Range` header parsing for the media route (ADR 0019, plan 5.2). Pure.
 * Supports `bytes=a-b`, `bytes=a-` and `bytes=-n`. Multi-range, malformed or unsatisfiable input is
 * reported so the route can answer 416 and never read outside the file.
 */
export type ByteRange =
  { kind: 'full' } | { kind: 'partial'; start: number; end: number } | { kind: 'unsatisfiable' };

export function parseByteRange(header: string | null | undefined, size: number): ByteRange {
  if (header === null || header === undefined || header === '') return { kind: 'full' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || size <= 0) return { kind: 'unsatisfiable' };
  const a = m[1] ?? '';
  const b = m[2] ?? '';
  if (a === '' && b === '') return { kind: 'unsatisfiable' };
  if (a.length > 15 || b.length > 15) return { kind: 'unsatisfiable' };
  if (a === '') {
    const n = Number(b);
    if (n === 0) return { kind: 'unsatisfiable' };
    return { kind: 'partial', start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  if (start >= size) return { kind: 'unsatisfiable' };
  const end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  if (end < start) return { kind: 'unsatisfiable' };
  return { kind: 'partial', start, end };
}

/** At most this many bytes per response; the player requests the rest with further ranges. */
export const MAX_MEDIA_RESPONSE_BYTES = 8 * 1024 * 1024;
