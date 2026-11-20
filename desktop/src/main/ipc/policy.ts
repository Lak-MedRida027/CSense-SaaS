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
  /** The channel makes API requests: it also draws from the aggregate token bucket (P6-L2). */
  callsApi: boolean;
}

/** Aggregate budget across every API-calling channel: sustained calls per second and burst size. */
export const AGGREGATE_API_RATE = { perSecond: 5, burst: 20 } as const;

const phase5 = {
  requiresRelease: false,
  duringLockdown: 'allow',
  ratePerSecond: 20,
  callsApi: false,
} as const;
const phase5Api = { ...phase5, callsApi: true } as const;
const journey = (ratePerSecond = 20): ChannelPolicy => ({
  requiresRelease: true,
  duringLockdown: 'deny',
  ratePerSecond,
  callsApi: true,
});

export const IPC_CHANNEL_POLICY: Readonly<Record<IpcMethodKey, ChannelPolicy>> = Object.freeze({
  'session.getState': phase5,
  'session.login': phase5Api,
  'session.logout': phase5,

  'gate.getView': phase5,
  'gate.requestChallenge': phase5Api,
  'gate.submitAnswer': phase5Api,
  'gate.continue': phase5,
  'gate.continueOffline': phase5,

  'assessment.startSecure': phase5Api,
  'assessment.resume': phase5,
  'assessment.submit': phase5Api,
  'assessment.exit': phase5Api,

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
