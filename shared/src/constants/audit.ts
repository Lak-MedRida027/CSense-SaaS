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
  'learning.seed.reset',
  'learning.assessment.cooldown',
  'risk.level_changed',
  'escalation.opened',
  'escalation.retriggered',
  'escalation.acknowledged',
  'escalation.note_added',
  'escalation.resolved',
  'escalation.resolve_refused',
  'governance.critical_event_recorded',
  'audit.integrity_checked',
  'maintenance.reconcile_run',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_OUTCOMES = ['success', 'failure'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export const AUDIT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

export const AUDIT_TARGET_TYPES = ['user', 'session', 'escalation'] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];
