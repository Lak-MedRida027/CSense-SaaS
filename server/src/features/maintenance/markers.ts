import { Types } from 'mongoose';
import type { Logger } from 'pino';
import { ReconcileMarker, RECONCILE_REASONS } from '../../models/ReconcileMarker.js';

export type ReconcileReason = (typeof RECONCILE_REASONS)[number];

export interface MarkerService {
  /**
   * Remember that this employee needs a reconcile. A reason the marker does not have yet resets its
   * attempts and back-off, so a new failure is repaired even after earlier ones were parked. A
   * reason that is itself parked stays parked for operators. `auditKey` is the exact idempotency
   * key of an audit entry that failed to be written. A failure to mark is logged, never thrown.
   */
  mark(userId: string, reason: ReconcileReason, auditKey?: string): Promise<void>;
}

export function createMarkerService(deps: { logger: Logger }): MarkerService {
  const apply = async (userId: string, reason: ReconcileReason, auditKey?: string) => {
    const filter = { userId: new Types.ObjectId(userId) };
    const current = await ReconcileMarker.findOne(filter).select('reasons parkedReasons').lean();
    if (current?.parkedReasons.includes(reason)) {
      deps.logger.error(
        { event: 'reconcile_marker_parked_reason', userId, reason },
        'A failure of a reason parked for operators was not re-queued',
      );
      return;
    }
    const isNewReason = current === null || !current.reasons.includes(reason);
    await ReconcileMarker.updateOne(
      filter,
      {
        $addToSet: { reasons: reason },
        ...(auditKey ? { $push: { auditKeys: { $each: [auditKey], $slice: -20 } } } : {}),
        ...(isNewReason ? { $set: { attempts: 0, notBefore: null } } : {}),
      },
      { upsert: true },
    );
  };

  return {
    async mark(userId, reason, auditKey) {
      try {
        await apply(userId, reason, auditKey);
      } catch (err) {
        // A concurrent upsert may win the unique index; one retry covers it.
        try {
          await apply(userId, reason, auditKey);
        } catch (retryErr) {
          deps.logger.error(
            { err: retryErr, first: err, userId, reason },
            'Reconcile marker failed',
          );
        }
      }
    },
  };
}
