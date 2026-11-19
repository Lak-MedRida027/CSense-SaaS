/**
 * Per-channel policy (ADR 0020, plan 4.4): when a channel may be called and how often.
 *
 * - `requiresRelease`: refused with `GATE_LOCKED` until the pre-access gate has released the
 *   workstation. Session, gate and assessment channels run their own Phase 5 checks.
 * - `duringLockdown`: `deny` refuses with `LOCKDOWN_ACTIVE` while a quiz is locked down (closed
 *   book): module content and `me.*` never coexist with questions in the renderer.
 * - `ratePerSecond`: ceiling per channel (D6-10); the 20/s default protects the NAT budget (D5-24).
 *
 * Every declared channel needs a row: `assertIpcRegistry` fails start-up otherwise.
 */
import type { IpcMethodKey } from '../../shared/ipc';

export interface ChannelPolicy {
  requiresRelease: boolean;
  duringLockdown: 'allow' | 'deny';
  ratePerSecond: number;
}

const phase5 = { requiresRelease: false, duringLockdown: 'allow', ratePerSecond: 20 } as const;
const journey = (ratePerSecond = 20): ChannelPolicy => ({
  requiresRelease: true,
  duringLockdown: 'deny',
  ratePerSecond,
});

export const IPC_CHANNEL_POLICY: Readonly<Record<IpcMethodKey, ChannelPolicy>> = Object.freeze({
  'session.getState': phase5,
  'session.login': phase5,
  'session.logout': phase5,

  'gate.getView': phase5,
  'gate.requestChallenge': phase5,
  'gate.submitAnswer': phase5,
  'gate.continue': phase5,
  'gate.continueOffline': phase5,

  'assessment.startSecure': phase5,
  'assessment.resume': phase5,
  'assessment.submit': phase5,
  'assessment.exit': phase5,

  'learning.getOverview': journey(),
  'learning.getQuizOverview': journey(),
  'learning.getModule': journey(),
  'learning.startModule': journey(2),
  'learning.answerExercise': journey(5),
  'learning.completeContent': journey(2),
  'learning.getFinalTestOverview': journey(),

  'me.getXp': journey(),
  'me.getBadges': journey(),
  'me.completeOnboarding': journey(1),
});
