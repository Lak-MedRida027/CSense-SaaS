import { Types } from 'mongoose';
import type { Logger } from 'pino';
import { ReconcileMarker } from '../../models/index.js';
import type { EscalationService } from '../governance/escalation.service.js';
import type { ReconcileService } from './reconcile.service.js';

const BATCH = 50;
const MAX_ATTEMPTS = 10;
const OUTBOX_GRACE_MS = 60_000;

export interface SweepSummary {
  reconciled: number;
  failed: number;
  auditWritten: number;
}

export interface Sweeper {
  /** One pass: reconcile marked employees, then complete audit entries left behind. */
  sweepOnce(): Promise<SweepSummary>;
  start(intervalSeconds: number): void;
  stop(): void;
}

export interface SweeperDeps {
  logger: Logger;
  clock: () => Date;
  reconcile: ReconcileService;
  escalations: EscalationService;
}

/**
 * Repairs what a failed hook or audit write left behind (ADR 0008, 0011). Markers are claimed with
 * an atomic find-and-delete, so two sweepers never take the same one. Every repair is idempotent.
 */
export function createSweeper(deps: SweeperDeps): Sweeper {
  let timer: NodeJS.Timeout | undefined;
  let running = false;

  async function sweepOnce(): Promise<SweepSummary> {
    const summary: SweepSummary = { reconciled: 0, failed: 0, auditWritten: 0 };
    for (let i = 0; i < BATCH; i += 1) {
      const marker = await ReconcileMarker.findOneAndDelete({}, { sort: { createdAt: 1 } }).lean();
      if (!marker) break;
      const userId = marker.userId.toHexString();
      try {
        const diff = await deps.reconcile.reconcileUser(userId);
        summary.reconciled += 1;
        summary.auditWritten += diff.auditWritten;
      } catch (err) {
        summary.failed += 1;
        deps.logger.error({ err, userId }, 'Reconcile of a marked employee failed');
        if (marker.attempts + 1 < MAX_ATTEMPTS) {
          await ReconcileMarker.updateOne(
            { userId: new Types.ObjectId(userId) },
            { $addToSet: { reasons: { $each: marker.reasons } }, $inc: { attempts: 1 } },
            { upsert: true },
          ).catch((e: unknown) => {
            deps.logger.error({ err: e, userId }, 'Could not re-queue reconcile marker');
          });
        }
      }
    }

    const cutoff = new Date(deps.clock().getTime() - OUTBOX_GRACE_MS);
    for (const escalationId of await deps.escalations.pendingAudit(cutoff)) {
      try {
        summary.auditWritten += await deps.escalations.flushAudit(escalationId);
      } catch (err) {
        summary.failed += 1;
        deps.logger.error({ err, escalationId }, 'Escalation audit outbox flush failed');
      }
    }
    return summary;
  }

  return {
    sweepOnce,
    start(intervalSeconds) {
      if (intervalSeconds <= 0 || timer) return;
      timer = setInterval(() => {
        if (running) return;
        running = true;
        sweepOnce()
          .catch((err: unknown) => {
            deps.logger.error({ err }, 'Sweep failed');
          })
          .finally(() => {
            running = false;
          });
      }, intervalSeconds * 1000);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
