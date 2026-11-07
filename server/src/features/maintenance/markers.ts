import { Types } from 'mongoose';
import type { Logger } from 'pino';
import { ReconcileMarker, RECONCILE_REASONS } from '../../models/ReconcileMarker.js';

export type ReconcileReason = (typeof RECONCILE_REASONS)[number];

export interface MarkerService {
  /** Remember that this employee needs a reconcile. A failure to mark is logged, never thrown. */
  mark(userId: string, reason: ReconcileReason): Promise<void>;
}

export function createMarkerService(deps: { logger: Logger }): MarkerService {
  return {
    async mark(userId, reason) {
      try {
        await ReconcileMarker.updateOne(
          { userId: new Types.ObjectId(userId) },
          { $addToSet: { reasons: reason }, $setOnInsert: { attempts: 0 } },
          { upsert: true },
        );
      } catch (err) {
        // A concurrent upsert may win the unique index; one retry covers it.
        try {
          await ReconcileMarker.updateOne(
            { userId: new Types.ObjectId(userId) },
            { $addToSet: { reasons: reason } },
            { upsert: true },
          );
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
