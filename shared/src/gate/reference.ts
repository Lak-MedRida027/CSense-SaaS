import { orgLocalDate } from './time.js';

/**
 * Reference an employee quotes to the security team: `GATE-<YYYYMMDD in the org zone>-<last 6 hex
 * of the run id, upper case>`. Administrators find the run through the escalation's source reference.
 */
export function formatGateReference(
  runId: string,
  closedAt: Date | string,
  timeZone: string,
): string {
  const day = orgLocalDate(closedAt, timeZone).replaceAll('-', '');
  return `GATE-${day}-${runId.slice(-6).toUpperCase()}`;
}
