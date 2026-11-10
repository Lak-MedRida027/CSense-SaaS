import { describe, expect, it } from 'vitest';
import { ONBOARDING_OUTCOMES } from '../constants/onboarding.js';
import { onboardingRequestSchema } from './onboarding.js';
import { onboardingStateSchema } from './onboardingResponses.js';

describe('onboarding schemas', () => {
  it('ONB1: request accepts exactly the two outcomes and nothing else', () => {
    expect([...ONBOARDING_OUTCOMES]).toEqual(['completed', 'skipped']);
    expect(onboardingRequestSchema.safeParse({ outcome: 'completed' }).success).toBe(true);
    expect(onboardingRequestSchema.safeParse({ outcome: 'skipped' }).success).toBe(true);
    expect(onboardingRequestSchema.safeParse({ outcome: 'done' }).success).toBe(false);
    expect(onboardingRequestSchema.safeParse({}).success).toBe(false);
    expect(onboardingRequestSchema.safeParse({ outcome: 'completed', at: 'x' }).success).toBe(
      false,
    );
    expect(onboardingRequestSchema.safeParse({ onboarding: null }).success).toBe(false);
  });

  it('ONB2: state is strict', () => {
    const ok = { outcome: 'skipped', at: '2026-11-10T10:00:00.000Z' };
    expect(onboardingStateSchema.safeParse(ok).success).toBe(true);
    expect(onboardingStateSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(onboardingStateSchema.safeParse({ outcome: 'x', at: ok.at }).success).toBe(false);
    expect(onboardingStateSchema.safeParse({ outcome: 'completed' }).success).toBe(false);
  });
});
