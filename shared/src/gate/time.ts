/**
 * Organisation-local calendar day (`YYYY-MM-DD`) of an instant in an IANA time zone. Gate XP is one
 * entry per such day (ADR 0017). Throws RangeError for an unknown zone; the server validates
 * ORG_TIMEZONE at start-up.
 */
export function orgLocalDate(at: Date | string | number, timeZone: string): string {
  const instant = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(instant.getTime())) throw new RangeError('invalid instant');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** True when `timeZone` is a zone this runtime knows. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}
