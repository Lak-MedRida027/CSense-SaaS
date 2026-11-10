import type { AttemptResultDTO } from '../../../shared/dto';
import type { DesktopError, LockdownEndReason } from '../../../shared/ipcChannels';
import type { QuizResultData } from '../screens/Quiz';

/** User-facing copy for errors. Generic on purpose: never reveals whether an account exists. */
export function loginErrorMessage(error: DesktopError): string {
  switch (error.code) {
    case 'INVALID_CREDENTIALS':
    case 'INVALID_INPUT':
    case 'VALIDATION_ERROR':
      return 'Email or password is incorrect.';
    case 'RATE_LIMITED': {
      if (!error.retryAfterSeconds) return 'Too many attempts. Try again later.';
      const minutes = Math.max(1, Math.ceil(error.retryAfterSeconds / 60));
      return `Too many attempts. Try again in ${String(minutes)} minute${minutes === 1 ? '' : 's'}.`;
    }
    case 'NETWORK_UNAVAILABLE':
    case 'INTERNAL_ERROR':
      return "Can't reach CSense.";
    case 'MISCONFIGURED':
      return 'CSense is misconfigured. Contact IT.';
    default:
      return 'Sign-in failed. Try again.';
  }
}

export const SESSION_ENDED_MESSAGE = 'Your session ended. Please sign in again.';

export function gateErrorMessage(error: DesktopError): string {
  switch (error.code) {
    case 'NETWORK_UNAVAILABLE':
    case 'INTERNAL_ERROR':
      return "Can't reach CSense. Check your connection and try again.";
    case 'GATE_CHALLENGE_STALE':
      return 'That question expired. Here is the current one.';
    default:
      return 'Your answer could not be submitted. Try again.';
  }
}

function formatTime(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function quizStartErrorMessage(error: DesktopError): string {
  switch (error.code) {
    case 'ASSESSMENT_COOLDOWN': {
      const at = formatTime(error.details?.retryAt);
      return at ? `You can try again after ${at}.` : 'You can try again a little later.';
    }
    case 'CONTENT_INCOMPLETE':
    case 'MODULE_LOCKED':
    case 'FINAL_TEST_LOCKED':
      return 'Finish the module content first.';
    case 'ALREADY_PASSED':
      return 'You have already passed this assessment.';
    case 'RATE_LIMITED':
      return 'Too many starts. Try again in a few minutes.';
    case 'NETWORK_UNAVAILABLE':
    case 'INTERNAL_ERROR':
      return "Can't reach CSense. Try again.";
    case 'GATE_LOCKED':
      return 'Complete the security check first.';
    default:
      return 'The quiz could not start. Try again.';
  }
}

export function submitErrorMessage(error: DesktopError): string {
  switch (error.code) {
    case 'NETWORK_UNAVAILABLE':
    case 'INTERNAL_ERROR':
      return "Can't reach CSense. Your answers are kept: try submitting again.";
    case 'SESSION_EXPIRED':
    case 'SESSION_CLOSED':
      return 'The time limit for this attempt has passed.';
    case 'ASSESSMENT_COOLDOWN':
      return 'This attempt could not be submitted because of a waiting period.';
    default:
      return 'Your answers could not be submitted. Try again.';
  }
}

export function violationMessage(
  v: { kind: 'focus_lost' | 'devtools' | 'blocked_shortcut'; remaining: number } | null,
): string | undefined {
  if (!v) return undefined;
  if (v.kind === 'focus_lost') {
    return v.remaining > 0
      ? `You left secure mode. Leaving ${String(v.remaining)} more time${v.remaining === 1 ? '' : 's'} ends this attempt.`
      : 'You left secure mode too many times.';
  }
  if (v.kind === 'devtools') return 'Developer tools are not allowed during the quiz.';
  return 'That shortcut is disabled during the quiz.';
}

export const RESTARTED_MESSAGE =
  'CSense restarted the quiz screen. Your earlier answers were not kept.';

export function endedMessage(reason: LockdownEndReason | undefined): string {
  switch (reason) {
    case 'focus_lost':
      return 'This attempt ended because CSense lost focus.';
    case 'crash':
      return 'This attempt ended because the quiz screen stopped working.';
    case 'hard_cap':
    case 'session_expired':
      return 'This attempt ended because the time limit passed.';
    default:
      return 'This attempt has ended.';
  }
}

/** Auto-ended attempts are abandoned server-side (score 0); show that without waiting for the server. */
export function abandonedResult(totalCount: number): QuizResultData {
  return { scorePercent: 0, passed: false, correctCount: 0, totalCount };
}

export function toQuizResult(r: AttemptResultDTO, moduleTitle: string): QuizResultData {
  return {
    scorePercent: r.score,
    passed: r.passed,
    correctCount: r.correctCount,
    totalCount: r.totalCount,
    ...(r.effects.xpEarned !== undefined ? { xpEarned: r.effects.xpEarned } : {}),
    ...(r.effects.badge
      ? {
          badge: {
            id: r.effects.badge.id,
            name: r.effects.badge.name,
            motif: r.effects.badge.iconMotif,
            moduleTitle,
            earned: true,
          },
        }
      : {}),
  };
}
