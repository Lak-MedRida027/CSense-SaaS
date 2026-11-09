import { Types, trusted } from 'mongoose';
import type { Logger } from 'pino';
import { ReconcileMarker } from '../../models/index.js';
import type { EscalationService } from '../governance/escalation.service.js';
import type { ReconcileService } from './reconcile.service.js';

const BATCH = 50;
/** Claims after which a marker is parked: logged once, kept for operators, never claimed again. */
export const MARKER_MAX_ATTEMPTS = 10;
const OUTBOX_GRACE_MS = 60_000;
/** The disengagement scan reads at most SCAN_PAGES x SCAN_PAGE_SIZE employees per sweep. */
const SCAN_PAGES = 5;
const SCAN_PAGE_SIZE = 200;
/** A claimed marker is invisible to other sweepers for this long, even if this one crashes. */
const LEASE_MS = 60_000;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 3_600_000;

/** 30 s, 1 min, 2 min ... capped at 1 h, by the number of claims so far. */
export const markerBackoffMs = (attempts: number): number =>
  Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));

export interface SweepSummary {
  reconciled: number;
  failed: number;
  auditWritten: number;
  /** Disengagement escalations opened by this sweep's scan. */
  disengaged: number;
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
 * Repairs what a failed hook or audit write left behind (ADR 0008, 0011). A marker is claimed with
 * an atomic update that counts the attempt and leases it, so two sweepers never take the same one
 * and the count can only grow. A failed reconcile backs off exponentially; after
 * MARKER_MAX_ATTEMPTS the marker is parked for an operator. One sweep handles each marker at most
 * once. Every repair is idempotent.
 */
export function createSweeper(deps: SweeperDeps): Sweeper {
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  /** Where the rolling disengagement scan continues; null starts from the beginning. */
  let scanCursor: string | null = null;

  async function sweepOnce(): Promise<SweepSummary> {
    const summary: SweepSummary = { reconciled: 0, failed: 0, auditWritten: 0, disengaged: 0 };
    const handled: Types.ObjectId[] = [];
    for (let i = 0; i < BATCH; i += 1) {
      const now = deps.clock();
      const marker = await ReconcileMarker.findOneAndUpdate(
        {
          _id: trusted({ $nin: handled }),
          attempts: trusted({ $lt: MARKER_MAX_ATTEMPTS }),
          $or: [{ notBefore: null }, { notBefore: trusted({ $lte: now }) }],
        },
        {
          $inc: { attempts: 1 },
          $set: { notBefore: new Date(now.getTime() + LEASE_MS) },
        },
        { sort: { createdAt: 1 }, returnDocument: 'after' },
      ).lean();
      if (!marker) break;
      handled.push(marker._id);
      const userId = marker.userId.toHexString();
      try {
        const diff = await deps.reconcile.reconcileUser(userId);
        summary.reconciled += 1;
        summary.auditWritten += diff.auditWritten;
        // Delete only if nothing was added to the marker meanwhile; otherwise hand it back as new.
        const removed = await ReconcileMarker.deleteOne({
          _id: marker._id,
          reasons: [...marker.reasons],
        });
        if (removed.deletedCount === 0) {
          await ReconcileMarker.updateOne(
            { _id: marker._id },
            { $set: { attempts: 0, notBefore: null } },
          );
        }
      } catch (err) {
        summary.failed += 1;
        deps.logger.error(
          { err, userId, attempts: marker.attempts },
          'Reconcile of a marked employee failed',
        );
        if (marker.attempts >= MARKER_MAX_ATTEMPTS) {
          deps.logger.error(
            { event: 'reconcile_marker_parked', userId, attempts: marker.attempts },
            'Reconcile marker parked after repeated failures; an operator must run gamification:reconcile',
          );
        }
        await ReconcileMarker.updateOne(
          { _id: marker._id },
          {
            $set: {
              notBefore: new Date(deps.clock().getTime() + markerBackoffMs(marker.attempts)),
            },
          },
        ).catch((e: unknown) => {
          deps.logger.error({ err: e, userId }, 'Could not back off reconcile marker');
        });
      }
    }

    // Time passing is the trigger for disengagement, so it needs a periodic scan: a bounded,
    // paged read (indexed, no recompute) that continues where the last sweep stopped.
    try {
      for (let page = 0; page < SCAN_PAGES; page += 1) {
        const result = await deps.escalations.scanDisengaged({
          afterId: scanCursor,
          pageSize: SCAN_PAGE_SIZE,
        });
        summary.disengaged += result.opened;
        scanCursor = result.next;
        if (result.next === null) break;
      }
    } catch (err) {
      deps.logger.error({ err }, 'Disengagement scan failed');
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
