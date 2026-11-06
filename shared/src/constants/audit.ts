/** Closed list of audit actions. Phase 4 appends risk and escalation actions. */
export const AUDIT_ACTIONS = [
  'auth.login.succeeded',
  'auth.login.failed',
  'auth.login.rate_limited',
  'auth.login.account_targeted',
  'auth.refresh.reuse_detected',
  'auth.refresh.denied',
  'auth.logout',
  'user.created',
  'admin.bootstrapped',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_OUTCOMES = ['success', 'failure'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export const AUDIT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

export const AUDIT_TARGET_TYPES = ['user', 'session'] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];
