import { z } from 'zod';
import {
  ESCALATION_EVENT_TYPES,
  ESCALATION_REASONS,
  ESCALATION_RESOLUTIONS,
  ESCALATION_REVIEW_TIERS,
  ESCALATION_SEVERITIES,
  ESCALATION_SOURCE_TYPES,
  ESCALATION_STATUSES,
} from '../constants/governance.js';
import { DIMENSION_COVERAGE, RISK_LEVELS } from '../constants/risk.js';
import { ROLES } from '../constants/roles.js';

/** Strict response schemas for escalations. No email, password or token field exists here. */
const nullableScore = z.number().int().min(0).max(100).nullable();
const riskLevel = z.enum(RISK_LEVELS).nullable();

export const escalationSubjectSchema = z
  .object({ userId: z.string(), name: z.string(), department: z.string().nullable() })
  .strict();

export const escalationSummarySchema = z
  .object({
    id: z.string(),
    reason: z.enum(ESCALATION_REASONS),
    severity: z.enum(ESCALATION_SEVERITIES),
    reviewTier: z.enum(ESCALATION_REVIEW_TIERS),
    status: z.enum(ESCALATION_STATUSES),
    subject: escalationSubjectSchema,
    riskLevel,
    compositeScore: nullableScore,
    openedAt: z.string(),
    acknowledgedAt: z.string().nullable(),
    resolvedAt: z.string().nullable(),
    assignee: z.object({ id: z.string(), name: z.string() }).strict().nullable(),
    version: z.number().int().min(0),
  })
  .strict();

export const escalationEventSchema = z
  .object({
    eventId: z.string(),
    type: z.enum(ESCALATION_EVENT_TYPES),
    at: z.string(),
    actor: z
      .object({ id: z.string(), name: z.string(), role: z.enum(ROLES) })
      .strict()
      .nullable(),
    fromStatus: z.enum(ESCALATION_STATUSES).nullable(),
    toStatus: z.enum(ESCALATION_STATUSES).nullable(),
    note: z.string().nullable(),
    resolution: z.enum(ESCALATION_RESOLUTIONS).nullable(),
  })
  .strict();

const coverageSchema = z
  .object({
    knowledge: z.enum(DIMENSION_COVERAGE),
    behavioural: z.enum(DIMENSION_COVERAGE),
    simulation: z.enum(DIMENSION_COVERAGE),
    engagement: z.enum(DIMENSION_COVERAGE),
  })
  .strict();

const scoresSchema = z
  .object({
    knowledge: nullableScore,
    behavioural: nullableScore,
    simulation: nullableScore,
    engagement: nullableScore,
  })
  .strict();

export const escalationDetailSchema = escalationSummarySchema
  .extend({
    context: z
      .object({
        riskLevel,
        previousLevel: riskLevel,
        compositeScore: nullableScore,
        scores: scoresSchema.nullable(),
        coverage: coverageSchema.nullable(),
        riskAssessmentId: z.string().nullable(),
        modelVersion: z.number().int().nullable(),
      })
      .strict(),
    sourceRef: z.object({ type: z.enum(ESCALATION_SOURCE_TYPES), id: z.string() }).strict(),
    resolution: z.enum(ESCALATION_RESOLUTIONS).nullable(),
    managementReference: z.string().nullable(),
    events: z.array(escalationEventSchema),
  })
  .strict();

export const escalationListSchema = z
  .object({
    items: z.array(escalationSummarySchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
    counts: z
      .object({ open: z.number().int().min(0), acknowledged: z.number().int().min(0) })
      .strict(),
  })
  .strict();

export type EscalationSummaryDTO = z.infer<typeof escalationSummarySchema>;
export type EscalationEventDTO = z.infer<typeof escalationEventSchema>;
export type EscalationDetailDTO = z.infer<typeof escalationDetailSchema>;
export type EscalationListDTO = z.infer<typeof escalationListSchema>;
