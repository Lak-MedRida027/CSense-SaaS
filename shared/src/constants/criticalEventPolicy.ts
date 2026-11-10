import type { EscalationReviewTier, EscalationSeverity } from './governance.js';

/**
 * Severity and review tier of each critical-event escalation reason (ADR 0011, amended by ADR 0015
 * and decision D5-6). Kept in its own module so the policy has one reviewable home.
 *
 * - `simulation_credentials_submitted` stays management-tier (ADR 0011).
 * - `gate_access_restricted` goes to the security team: the requirement says restriction "alerts the
 *   security team". A different administrator must still resolve it (it is critical).
 */
export const CRITICAL_EVENT_POLICY = Object.freeze({
  simulation_credentials_submitted: Object.freeze({
    severity: 'critical',
    reviewTier: 'management',
  }),
  gate_access_restricted: Object.freeze({
    severity: 'critical',
    reviewTier: 'security_team',
  }),
} as const satisfies Record<
  string,
  { readonly severity: EscalationSeverity; readonly reviewTier: EscalationReviewTier }
>);

export type CriticalEventReason = keyof typeof CRITICAL_EVENT_POLICY;
