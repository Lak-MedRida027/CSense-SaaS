import { onboardingRequestSchema, type OnboardingStateDTO } from '@csense/shared';
import {
  EMPLOYEE_ONLY,
  defineRoute,
  requireAuth,
  type RouteDef,
} from '../../http/routeRegistry.js';
import { recordOnboarding } from './onboarding.service.js';

/**
 * `PATCH /me/onboarding` (FR4). Identity comes from the token only. Not allowed while the access
 * is restricted: a restricted employee must clear the gate first (ADR 0015).
 */
export function onboardingRoutes(deps: { clock: () => Date }): RouteDef[] {
  return [
    defineRoute({
      method: 'patch',
      path: '/me/onboarding',
      access: EMPLOYEE_ONLY,
      schemas: { body: onboardingRequestSchema },
      handler: (ctx): Promise<OnboardingStateDTO> =>
        recordOnboarding(requireAuth(ctx).userId, ctx.body.outcome, deps.clock()),
    }),
  ];
}
