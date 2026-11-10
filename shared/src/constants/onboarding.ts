/** How an employee left the first-run onboarding (FR4, ADR 0020). */
export const ONBOARDING_OUTCOMES = ['completed', 'skipped'] as const;
export type OnboardingOutcome = (typeof ONBOARDING_OUTCOMES)[number];
