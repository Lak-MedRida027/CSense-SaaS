import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import type { Logger } from 'pino';
import type { RestoreAccessDTO } from '@csense/shared';
import type { AppConfig } from '../../config/appConfig.js';
import { escalationNotAcknowledged, notFoundError, notRestricted } from '../../lib/httpError.js';
import { Employee, Escalation, GateRun } from '../../models/index.js';
import { audit, type AuditContext } from '../audit/audit.service.js';
import type { EscalationService } from '../governance/escalation.service.js';
import type { GateRunRow } from './gate.mapper.js';
import { clearRestrictionFlag, restoreAuditKey } from './gate.restriction.js';
import type { MarkerService } from '../maintenance/markers.js';

export interface RestoreServiceDeps {
  clock: () => Date;
  logger: Logger;
  gate: AppConfig['gate'];
  escalations: Pick<EscalationService, 'transition' | 'recordCriticalEvent'>;
  markers: MarkerService;
}

export interface RestoreService {
  restoreAccess(
    actorId: string,
    userId: string,
    note: string,
    ctx: AuditContext,
  ): Promise<RestoreAccessDTO>;
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/**
 * Administrator restores a restricted employee (D5-7, ADR 0015):
 *  1. the employee must exist and have a restricted, unrestored run (404 / 409 NOT_RESTRICTED);
 *  2. the run's escalation must be acknowledged when GATE_RESTORE_REQUIRES_ACK (409);
 *  3. the run is marked restored by compare-and-set (the single winner proceeds);
 *  4. the note is appended to the escalation (outbox-audited), then `gate.access_restored` is
 *     audited with the note's SHA-256 only. If either fails the restore is rolled back, so access
 *     is never restored without its record;
 *  5. the user flag is cleared. The run stays `restricted` (history); the escalation stays open or
 *     acknowledged: restoring never resolves it.
 */
export function createRestoreService(deps: RestoreServiceDeps): RestoreService {
  return {
    async restoreAccess(actorId, userId, note, ctx) {
      const owner = new Types.ObjectId(userId);
      if ((await Employee.exists({ _id: owner })) === null) throw notFoundError();

      const run = await GateRun.findOne({ userId: owner, status: 'restricted', restoredAt: null })
        .sort({ closedAt: -1, _id: -1 })
        .lean<GateRunRow>();
      if (!run) throw notRestricted();
      const runId = run._id.toHexString();

      // A restriction whose escalation write was lost is repaired here (idempotent), so there is
      // always an escalation to acknowledge and annotate.
      let escalationId = run.escalationId ?? null;
      if (!escalationId) {
        const recorded = await deps.escalations.recordCriticalEvent({
          userId,
          reason: 'gate_access_restricted',
          sourceRef: { type: 'gate_event', id: runId },
          occurredAt: run.closedAt ?? run.openedAt,
        });
        escalationId = new Types.ObjectId(recorded.escalationId);
        await GateRun.updateOne({ _id: run._id, escalationId: null }, { $set: { escalationId } });
      }
      const escalation = await Escalation.findById(escalationId).select('status').lean();
      if (!escalation) throw notFoundError();
      if (deps.gate.restoreRequiresAck && escalation.status === 'open') {
        throw escalationNotAcknowledged();
      }

      const now = deps.clock();
      const restoredBy = new Types.ObjectId(actorId);
      const claimed = await GateRun.findOneAndUpdate(
        { _id: run._id, status: 'restricted', restoredAt: null },
        { $set: { restoredAt: now, restoredBy }, $inc: { version: 1 } },
        { returnDocument: 'after' },
      ).lean<GateRunRow>();
      if (!claimed) throw notRestricted(); // a concurrent restore won

      const rollback = async (): Promise<void> => {
        await GateRun.updateOne(
          { _id: run._id, restoredBy },
          { $set: { restoredAt: null, restoredBy: null }, $inc: { version: 1 } },
        ).catch((err: unknown) => {
          deps.logger.error({ err, runId }, 'Gate restore rollback failed');
        });
      };
      const escalationHex = escalationId.toHexString();

      // 1. The audit entry first (keyed by run and claim time). If it cannot be written the restore
      //    is rolled back, and the escalation records that nothing changed (P5-L4). If the rollback
      //    itself fails, the flag is still set, so access stays blocked, and repairGate writes the
      //    missing entry (actor = restoredBy) before it ever clears the flag.
      try {
        await audit.record({
          action: 'gate.access_restored',
          outcome: 'success',
          severity: 'warning',
          actor: { id: actorId, role: 'administrator' },
          target: { type: 'user', id: owner },
          ctx,
          idempotencyKey: restoreAuditKey(runId, now),
          metadata: {
            runId,
            escalationId: escalationHex,
            noteSha256: sha256(note),
            noteLength: note.length,
          },
        });
      } catch (err) {
        await rollback();
        await deps.escalations
          .transition(
            escalationHex,
            {
              action: 'note',
              note: 'Restore rolled back: the restore attempt could not be recorded, access is still restricted.',
            },
            { actorId, ...ctx },
          )
          .catch((noteErr: unknown) => {
            deps.logger.error({ err: noteErr, runId }, 'Gate restore rollback note failed');
          });
        throw err;
      }

      // 2. Lift the access-gate cache. A failure leaves a marker (and the sweeper scans for it).
      let flagError: Error | null = null;
      try {
        await clearRestrictionFlag(userId, runId);
      } catch (err) {
        flagError = err instanceof Error ? err : new Error(String(err));
        deps.logger.error({ err, runId }, 'Gate restore could not clear the user flag');
        await deps.markers.mark(userId, 'gate');
      }

      // 3. The administrator note goes on the escalation only after the restore succeeded.
      try {
        await deps.escalations.transition(
          escalationHex,
          { action: 'note', note },
          { actorId, ...ctx },
        );
      } catch (err) {
        deps.logger.error({ err, runId }, 'Gate restore note could not be appended');
      }
      if (flagError !== null) throw flagError;
      return {
        userId,
        runId,
        escalationId: escalationId.toHexString(),
        restoredAt: now.toISOString(),
      };
    },
  };
}
