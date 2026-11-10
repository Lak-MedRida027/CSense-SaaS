/** Pre-access security gate constants (Phase 5, ADR 0015, ADR 0017). */
export const GATE_STATES = ['required', 'challenge', 'granted', 'restricted'] as const;
export type GateState = (typeof GATE_STATES)[number];

export const GATE_RUN_STATUSES = ['open', 'passed', 'restricted'] as const;
export type GateRunStatus = (typeof GATE_RUN_STATUSES)[number];

/** Attempts per gate run (GATE_MAX_ATTEMPTS). */
export const GATE_ATTEMPTS_MIN = 1;
export const GATE_ATTEMPTS_MAX = 10;
export const GATE_ATTEMPTS_DEFAULT = 3;

/** Clearance lifetime after a pass (GATE_CLEARANCE_TTL), in seconds. */
export const GATE_CLEARANCE_TTL_MIN_SECONDS = 5 * 60;
export const GATE_CLEARANCE_TTL_MAX_SECONDS = 24 * 3600;
export const GATE_CLEARANCE_TTL_DEFAULT = '12h';

/** Options per gate question. */
export const GATE_OPTION_MIN = 3;
export const GATE_OPTION_MAX = 6;

/** How many of an employee's most recently served gate questions the selection avoids. */
export const GATE_SELECTION_HISTORY = 30;

/** Risk model v2 (ADR 0017): the gate score reads the last N closed runs. */
export const GATE_RISK_WINDOW = 20;
export const GATE_RESTRICTION_POINTS = 35;
export const GATE_RESTRICTION_CAP = 2;

/** Note an administrator must give when restoring access (same bounds as escalation notes). */
export const GATE_RESTORE_NOTE_MAX = 2000;

/** XP source key prefix: one entry per organisation-local day, `gate:<YYYY-MM-DD>`. */
export const GATE_XP_KEY_PREFIX = 'gate:';

/** Challenge lifetime (GATE_CHALLENGE_TTL, ADR 0015): an unanswered challenge expires after this. */
export const GATE_CHALLENGE_TTL_MIN_SECONDS = 60;
export const GATE_CHALLENGE_TTL_MAX_SECONDS = 3600;
export const GATE_CHALLENGE_TTL_DEFAULT = '10m';

/** Offline-release reports (POST /gate/offline-releases). */
export const GATE_OFFLINE_REASONS = ['api_unreachable'] as const;
export type GateOfflineReason = (typeof GATE_OFFLINE_REASONS)[number];
/** A report older than this is refused; one dated in the future (beyond clock skew) too. */
export const GATE_OFFLINE_MAX_AGE_DAYS = 30;
export const GATE_OFFLINE_FUTURE_SKEW_SECONDS = 300;
export const GATE_OFFLINE_DURATION_MAX_SECONDS = GATE_OFFLINE_MAX_AGE_DAYS * 86_400;
