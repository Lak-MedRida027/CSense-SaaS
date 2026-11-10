import { z } from 'zod';
import {
  AUDIT_ACTIONS,
  AUDIT_OUTCOMES,
  AUDIT_SEVERITIES,
  AUDIT_TARGET_TYPES,
} from '../constants/audit.js';
import { ROLES } from '../constants/roles.js';

export const auditLogSchema = z
  .object({
    id: z.string(),
    seq: z.number().int().min(1).nullable(),
    action: z.enum(AUDIT_ACTIONS),
    outcome: z.enum(AUDIT_OUTCOMES),
    severity: z.enum(AUDIT_SEVERITIES),
    actorId: z.string().nullable(),
    actorRole: z.enum(ROLES).nullable(),
    targetType: z.enum(AUDIT_TARGET_TYPES).nullable(),
    targetId: z.string().nullable(),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
    requestId: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
    prevHash: z.string().nullable(),
    hash: z.string().nullable(),
    idempotencyKey: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();

export const auditLogListSchema = z
  .object({
    items: z.array(auditLogSchema),
    nextCursor: z.number().int().min(1).nullable(),
  })
  .strict();

export type AuditLogDTO = z.infer<typeof auditLogSchema>;
export type AuditLogListDTO = z.infer<typeof auditLogListSchema>;
