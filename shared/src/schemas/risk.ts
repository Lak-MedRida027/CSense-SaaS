import { z } from 'zod';
import { objectIdSchema } from './common.js';

/** Ids are lower-cased so a differently-cased copy compares equal. */
const idSchema = objectIdSchema.transform((v) => v.toLowerCase());

export const userIdParamsSchema = z.object({ userId: idSchema }).strict();

const pageShape = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

export const RISK_PROFILE_LIST_LEVELS = ['Low', 'Medium', 'High', 'unassessed'] as const;
export const RISK_PROFILE_SORTS = [
  'composite_desc',
  'composite_asc',
  'name_asc',
  'computed_desc',
] as const;

export const listRiskProfilesQuerySchema = z
  .object({
    ...pageShape,
    level: z.enum(RISK_PROFILE_LIST_LEVELS).optional(),
    department: z.string().trim().min(1).max(120).optional(),
    sort: z.enum(RISK_PROFILE_SORTS).default('composite_desc'),
  })
  .strict();

export type ListRiskProfilesQuery = z.infer<typeof listRiskProfilesQuerySchema>;
export { pageShape as paginationShape };
