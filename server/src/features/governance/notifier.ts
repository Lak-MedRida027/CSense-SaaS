import type { Logger } from 'pino';
import type { EscalationReason, EscalationReviewTier, EscalationSeverity } from '@csense/shared';

/** What the security team is told. No names, e-mail addresses or notes: only ids and categories. */
export interface EscalationNotice {
  escalationId: string;
  reason: EscalationReason;
  severity: EscalationSeverity;
  reviewTier: EscalationReviewTier;
}

/**
 * How the security team learns about an escalation (ADR 0011, D4-17). Phase 4 logs it and exposes
 * the open count in the API; the admin console and OS notifications come in Phase 7, e-mail not
 * before Phase 10. Implementations must never throw into the caller.
 */
export interface SecurityTeamNotifier {
  escalationOpened(notice: EscalationNotice): void | Promise<void>;
  escalationRetriggered(notice: EscalationNotice): void | Promise<void>;
}

export function createLogNotifier(logger: Logger): SecurityTeamNotifier {
  return {
    escalationOpened: (notice) => {
      logger.warn({ event: 'escalation.opened', ...notice }, 'Governance escalation opened');
    },
    escalationRetriggered: (notice) => {
      logger.warn(
        { event: 'escalation.retriggered', ...notice },
        'Governance escalation retriggered',
      );
    },
  };
}

/** Wraps a notifier so a failure is logged and swallowed. */
export function safeNotifier(inner: SecurityTeamNotifier, logger: Logger): SecurityTeamNotifier {
  const guard =
    (name: keyof SecurityTeamNotifier) =>
    async (notice: EscalationNotice): Promise<void> => {
      try {
        await inner[name](notice);
      } catch (err) {
        logger.error({ err, notifier: name }, 'Security team notifier failed');
      }
    };
  return {
    escalationOpened: guard('escalationOpened'),
    escalationRetriggered: guard('escalationRetriggered'),
  };
}
