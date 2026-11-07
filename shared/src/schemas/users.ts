import { z } from 'zod';
import { ROLES } from '../constants/roles.js';
import { emailSchema, newPasswordSchema } from './common.js';

export const createUserRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: emailSchema,
    password: newPasswordSchema,
    role: z.enum(ROLES),
    department: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
