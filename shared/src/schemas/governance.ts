import { z } from 'zod';
import {
  ESCALATION_NOTE_MAX,
  ESCALATION_REASONS,
  ESCALATION_REFERENCE_MAX,
  ESCALATION_RESOLUTIONS,
  ESCALATION_SEVERITIES,
} from '../constants/governance.js';
import { objectIdSchema } from './common.js';
import { paginationShape } from './risk.js';
import { isCleanText } from './text.js';

const idSchema = objectIdSchema.transform((v) => v.toLowerCase());

export const escalationParamsSchema = z.object({ escalationId: idSchema }).strict();

export const escalationNoteSchema = z
  .string()
  .trim()
  .min(1)
  .max(ESCALATION_NOTE_MAX)
  .refine(isCleanText, { message: 'contains control characters or invalid characters' });

const expectedVersion = z.int().min(0).max(1_000_000);

export const escalationActionRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('acknowledge'),
      expectedVersion,
      note: escalationNoteSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('note'),
      expectedVersion: expectedVersion.optional(),
      note: escalationNoteSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('resolve'),
      expectedVersion,
      resolution: z.enum(ESCALATION_RESOLUTIONS),
      note: escalationNoteSchema,
      managementReference: z
        .string()
        .trim()
        .min(1)
        .max(ESCALATION_REFERENCE_MAX)
        .refine(isCleanText, { message: 'contains control characters or invalid characters' })
        .optional(),
    })
    .strict(),
]);

export const LIST_ESCALATION_STATUSES = ['open', 'acknowledged', 'resolved', 'active'] as const;

export const listEscalationsQuerySchema = z
  .object({
    ...paginationShape,
    status: z.enum(LIST_ESCALATION_STATUSES).optional(),
    severity: z.enum(ESCALATION_SEVERITIES).optional(),
    reason: z.enum(ESCALATION_REASONS).optional(),
    userId: idSchema.optional(),
  })
  .strict();

export type EscalationActionRequest = z.infer<typeof escalationActionRequestSchema>;
export type ListEscalationsQuery = z.infer<typeof listEscalationsQuerySchema>;
