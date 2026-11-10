import type { EscalationAction, EscalationStatus } from '../constants/governance.js';

export type EscalationTransition =
  { ok: true; next: EscalationStatus } | { ok: false; reason: 'invalid_transition' };

/**
 * The escalation state machine (ADR 0011): open -> acknowledged -> resolved. Notes are allowed in
 * any state and never change it. There is no reopen.
 */
export function applyEscalationAction(
  status: EscalationStatus,
  action: EscalationAction,
): EscalationTransition {
  if (action === 'note') return { ok: true, next: status };
  if (action === 'acknowledge' && status === 'open') return { ok: true, next: 'acknowledged' };
  if (action === 'resolve' && status === 'acknowledged') return { ok: true, next: 'resolved' };
  return { ok: false, reason: 'invalid_transition' };
}
