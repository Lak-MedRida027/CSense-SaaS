import { z } from 'zod';
import { ONBOARDING_OUTCOMES } from '../constants/onboarding.js';

/** Body of `PATCH /me/onboarding`. Strict: the server stamps the time, the caller only names the outcome. */
export const onboardingRequestSchema = z.object({ outcome: z.enum(ONBOARDING_OUTCOMES) }).strict();
