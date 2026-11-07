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

const idSchema = objectIdSchema.transform((v) => v.toLowerCase());

export const escalationParamsSchema = z.object({ escalationId: idSchema }).strict();

/** Control characters other than newline and tab are rejected (log injection, display tricks). */
const hasOnlyAllowedChars = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0x0a || code === 0x09) continue;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
};

export const escalationNoteSchema = z
  .string()
  .trim()
  .min(1)
  .max(ESCALATION_NOTE_MAX)
  .refine(hasOnlyAllowedChars, { message: 'contains control characters' });

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
      managementReference: z.string().trim().min(1).max(ESCALATION_REFERENCE_MAX).optional(),
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
