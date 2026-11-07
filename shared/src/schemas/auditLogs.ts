import { z } from 'zod';
import {
  AUDIT_ACTIONS,
  AUDIT_OUTCOMES,
  AUDIT_SEVERITIES,
  AUDIT_TARGET_TYPES,
} from '../constants/audit.js';
import { objectIdSchema } from './common.js';

const idSchema = objectIdSchema.transform((v) => v.toLowerCase());

/** Filters for the read-only audit log. `before` is an exclusive sequence cursor (newest first). */
export const listAuditLogsQuerySchema = z
  .object({
    action: z.enum(AUDIT_ACTIONS).optional(),
    severity: z.enum(AUDIT_SEVERITIES).optional(),
    outcome: z.enum(AUDIT_OUTCOMES).optional(),
    actorId: idSchema.optional(),
    targetType: z.enum(AUDIT_TARGET_TYPES).optional(),
    targetId: idSchema.optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    before: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict()
  .refine(
    (q) => q.from === undefined || q.to === undefined || Date.parse(q.from) <= Date.parse(q.to),
    {
      message: 'from must not be after to',
      path: ['from'],
    },
  );

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
