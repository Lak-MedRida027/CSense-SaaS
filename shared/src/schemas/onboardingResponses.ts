import { z } from 'zod';
import { ONBOARDING_OUTCOMES } from '../constants/onboarding.js';

/** `EmployeeDTO.onboarding` and the `PATCH /me/onboarding` response. `at` is an ISO timestamp. */
export const onboardingStateSchema = z
  .object({
    outcome: z.enum(ONBOARDING_OUTCOMES),
    at: z.string().max(40),
  })
  .strict();
