import { trusted, type Types } from 'mongoose';
import type { OnboardingOutcome, OnboardingStateDTO } from '@csense/shared';
import { notFoundError } from '../../lib/httpError.js';
import { Employee } from '../../models/index.js';

interface StoredOnboarding {
  outcome: OnboardingOutcome;
  at: Date;
}

const toDto = (o: StoredOnboarding): OnboardingStateDTO => ({
  outcome: o.outcome,
  at: o.at.toISOString(),
});

/**
 * Records the first-run onboarding outcome. First write wins: the conditional update only matches
 * while `onboarding` is still null, so concurrent or repeated calls return the stored state.
 * No XP, risk or audit effect (ADR 0020).
 */
export async function recordOnboarding(
  userId: string,
  outcome: OnboardingOutcome,
  now: Date,
): Promise<OnboardingStateDTO> {
  const updated = await Employee.findOneAndUpdate(
    trusted({ _id: userId, onboarding: null }),
    { $set: { onboarding: { outcome, at: now } } },
    { returnDocument: 'after' },
  )
    .select('onboarding')
    .lean<{ _id: Types.ObjectId; onboarding: StoredOnboarding | null }>();
  if (updated?.onboarding) return toDto(updated.onboarding);

  const existing = await Employee.findById(userId)
    .select('onboarding')
    .lean<{ onboarding?: StoredOnboarding | null }>();
  if (!existing) throw notFoundError();
  if (!existing.onboarding) throw notFoundError();
  return toDto(existing.onboarding);
}
