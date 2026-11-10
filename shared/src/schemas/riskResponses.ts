import { z } from 'zod';
import { DIMENSION_COVERAGE, GOVERNANCE_STATES, RISK_LEVELS } from '../constants/risk.js';
import { escalationSummarySchema } from './governanceResponses.js';

/** Strict response schemas for the administrator risk endpoints. No email or credential field. */
const nullableScore = z.number().int().min(0).max(100).nullable();
const riskLevel = z.enum(RISK_LEVELS).nullable();

export const riskScoresSchema = z
  .object({
    knowledge: nullableScore,
    behavioural: nullableScore,
    simulation: nullableScore,
    engagement: nullableScore,
  })
  .strict();

export const riskCoverageSchema = z
  .object({
    knowledge: z.enum(DIMENSION_COVERAGE),
    behavioural: z.enum(DIMENSION_COVERAGE),
    simulation: z.enum(DIMENSION_COVERAGE),
    engagement: z.enum(DIMENSION_COVERAGE),
  })
  .strict();

const weightsSchema = z
  .object({
    knowledge: z.number().int().min(0),
    behavioural: z.number().int().min(0),
    simulation: z.number().int().min(0),
    engagement: z.number().int().min(0),
  })
  .strict();

export const riskProfileSummarySchema = z
  .object({
    userId: z.string(),
    name: z.string(),
    department: z.string().nullable(),
    isActive: z.boolean(),
    compositeScore: nullableScore,
    riskLevel,
    governanceState: z.enum(GOVERNANCE_STATES).nullable(),
    scores: riskScoresSchema,
    coverage: riskCoverageSchema,
    computedAt: z.string().nullable(),
    /** When the employee became (and, if riskLevel is null, still is) unassessed: account creation. */
    unassessedSince: z.string().nullable(),
    /** An active disengaged_unassessed escalation exists for this employee. */
    disengaged: z.boolean(),
  })
  .strict();

export const riskEvidenceSchema = z
  .object({
    attempts: z.number().int().min(0),
    firstAttempts: z.number().int().min(0),
    abandoned: z.number().int().min(0),
    expired: z.number().int().min(0),
    extraFailures: z.number().int().min(0),
    cooldowns: z.number().int().min(0),
    passedModules: z.number().int().min(0),
    curriculumSize: z.number().int().min(0),
    finalTestPassed: z.boolean(),
    simulationOutcomes: z.number().int().min(0),
  })
  .strict();

export const riskAssessmentSchema = z
  .object({
    id: z.string(),
    computedAt: z.string(),
    modelVersion: z.number().int(),
    compositeScore: nullableScore,
    riskLevel,
    previousLevel: riskLevel,
    levelChanged: z.boolean(),
    scores: riskScoresSchema,
    coverage: riskCoverageSchema,
    trigger: z.object({ type: z.string(), refId: z.string().nullable() }).strict(),
  })
  .strict();

export const riskProfileListSchema = z
  .object({
    items: z.array(riskProfileSummarySchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
  })
  .strict();

export const riskProfileDetailSchema = z
  .object({
    profile: riskProfileSummarySchema
      .extend({
        modelVersion: z.number().int().nullable(),
        effectiveWeightsBp: weightsSchema.nullable(),
        nominalWeightsBp: weightsSchema,
        evidence: riskEvidenceSchema.nullable(),
      })
      .strict(),
    history: z.array(riskAssessmentSchema),
    escalations: z.array(escalationSummarySchema),
  })
  .strict();

export type RiskProfileSummaryDTO = z.infer<typeof riskProfileSummarySchema>;
export type RiskProfileListDTO = z.infer<typeof riskProfileListSchema>;
export type RiskAssessmentDTO = z.infer<typeof riskAssessmentSchema>;
export type RiskProfileDetailDTO = z.infer<typeof riskProfileDetailSchema>;
