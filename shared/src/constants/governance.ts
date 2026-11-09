/** Governance escalation vocabulary (Phase 4, ADR 0011). */
export const ESCALATION_REASONS = [
  'risk_level_high',
  'simulation_credentials_submitted',
  'gate_access_restricted',
  'repeated_assessment_cooldowns',
] as const;
export type EscalationReason = (typeof ESCALATION_REASONS)[number];

export const ESCALATION_SEVERITIES = ['elevated', 'critical'] as const;
export type EscalationSeverity = (typeof ESCALATION_SEVERITIES)[number];

export const ESCALATION_REVIEW_TIERS = ['security_team', 'management'] as const;
export type EscalationReviewTier = (typeof ESCALATION_REVIEW_TIERS)[number];

export const ESCALATION_STATUSES = ['open', 'acknowledged', 'resolved'] as const;
export type EscalationStatus = (typeof ESCALATION_STATUSES)[number];

export const ESCALATION_ACTIONS = ['acknowledge', 'note', 'resolve'] as const;
export type EscalationAction = (typeof ESCALATION_ACTIONS)[number];

export const ESCALATION_EVENT_TYPES = [
  'opened',
  'retriggered',
  'acknowledged',
  'note',
  'resolved',
] as const;
export type EscalationEventType = (typeof ESCALATION_EVENT_TYPES)[number];

export const ESCALATION_RESOLUTIONS = [
  'remediated',
  'risk_accepted',
  'false_positive',
  'no_action_required',
] as const;
export type EscalationResolution = (typeof ESCALATION_RESOLUTIONS)[number];

export const ESCALATION_SOURCE_TYPES = [
  'risk_assessment',
  'phishing_event',
  'gate_event',
  'audit_entry',
] as const;
export type EscalationSourceType = (typeof ESCALATION_SOURCE_TYPES)[number];

export const ESCALATION_NOTE_MAX = 2000;
export const ESCALATION_EVENTS_MAX = 200;
/**
 * Events kept free for administrators. System events (opened, retriggered) stop at
 * ESCALATION_EVENTS_MAX - ESCALATION_ADMIN_RESERVE; later retriggers only move counters.
 */
export const ESCALATION_ADMIN_RESERVE = 50;
export const ESCALATION_REFERENCE_MAX = 200;
