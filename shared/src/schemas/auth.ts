import { z } from 'zod';
import { REFRESH_TOKEN_MAX_LENGTH } from '../constants/auth.js';
import { emailSchema, loginPasswordSchema } from './common.js';

export const loginRequestSchema = z
  .object({ email: emailSchema, password: loginPasswordSchema })
  .strict();

export const refreshRequestSchema = z
  .object({ refreshToken: z.string().min(1).max(REFRESH_TOKEN_MAX_LENGTH) })
  .strict();

export const logoutRequestSchema = refreshRequestSchema;
