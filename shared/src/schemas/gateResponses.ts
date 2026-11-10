import { z } from 'zod';
import { GATE_OPTION_MAX, GATE_OPTION_MIN, GATE_STATES } from '../constants/gate.js';

/**
 * Strict gate response schemas (ADR 0015). There is deliberately no field that could carry the
 * correct option: the server never returns it, on a pass or a failure. The desktop main process
 * parses every gate response with these before it crosses IPC.
 */
export const gateChallengeSchema = z
  .object({
    challengeId: z.string(),
    prompt: z.string(),
    options: z.array(z.string()).min(GATE_OPTION_MIN).max(GATE_OPTION_MAX),
  })
  .strict();

export const gateRestrictedSchema = z
  .object({
    /** `GATE-<YYYYMMDD>-<6 hex>`: what the employee quotes to the security team. */
    referenceId: z.string(),
    since: z.string(),
  })
  .strict();

export const gateStatusSchema = z
  .object({
    state: z.enum(GATE_STATES),
    maxAttempts: z.number().int().min(1),
    attemptsRemaining: z.number().int().min(0),
    /** Only in `challenge`. */
    challenge: gateChallengeSchema.nullable(),
    /** ISO time; only in `granted`. */
    clearedUntil: z.string().nullable(),
    /** Only in `restricted`. */
    restricted: gateRestrictedSchema.nullable(),
  })
  .strict();

export const gateAttemptResultSchema = z
  .object({
    correct: z.boolean(),
    /** Teaches the concept; never names the correct option. */
    explanation: z.string(),
    xpEarned: z.number().int().min(0),
    status: gateStatusSchema,
  })
  .strict();

export const restoreAccessSchema = z
  .object({
    userId: z.string(),
    runId: z.string(),
    escalationId: z.string(),
    restoredAt: z.string(),
  })
  .strict();

export type GateChallengeDTO = z.infer<typeof gateChallengeSchema>;
export type GateStatusDTO = z.infer<typeof gateStatusSchema>;
export type GateAttemptResultDTO = z.infer<typeof gateAttemptResultSchema>;
export type RestoreAccessDTO = z.infer<typeof restoreAccessSchema>;

export const gateOfflineReleaseResultSchema = z
  .object({
    /** Always true: the report is stored. */
    recorded: z.literal(true),
    /** True when the same report (user and releasedAt) had been stored before. */
    duplicate: z.boolean(),
    /** True when the employee was restricted at the time: the security team was told as well. */
    escalated: z.boolean(),
  })
  .strict();
export type GateOfflineReleaseResultDTO = z.infer<typeof gateOfflineReleaseResultSchema>;
