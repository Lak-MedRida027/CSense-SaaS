import { Types } from 'mongoose';
import { Employee, GateRun } from '../../models/index.js';
import type { EscalationService } from '../governance/escalation.service.js';
import type { RiskService } from '../risk/risk.service.js';

export interface RestrictionDeps {
  escalations: Pick<EscalationService, 'recordCriticalEvent'>;
  /** Omitted by reconcile, which recomputes risk in its own step. */
  risk?: Pick<RiskService, 'recomputeForUser'>;
}

export interface RestrictionTarget {
  userId: string;
  runId: string;
  restrictedAt: Date;
}

/**
 * The side effects of a restriction (ADR 0015), each idempotent so they can be repeated by the
 * request that caused the restriction and by reconcile:
 *   1. the user flag the access gate reads (only while the run is still unrestored),
 *   2. the critical escalation (exactly once per run: dedupe key) and the run's pointer to it,
 *   3. the risk recompute.
 * Steps run in this order; an error is thrown to the caller after all steps were attempted, so a
 * failing escalation never keeps the flag from being set. Returns the escalation id.
 */
export async function applyRestrictionEffects(
  deps: RestrictionDeps,
  target: RestrictionTarget,
): Promise<{ escalationId: string }> {
  const errors: unknown[] = [];
  let escalationId: string | null = null;
  const run = new Types.ObjectId(target.runId);

  try {
    await setRestrictionFlag(target);
  } catch (err) {
    errors.push(err);
  }

  try {
    const recorded = await deps.escalations.recordCriticalEvent({
      userId: target.userId,
      reason: 'gate_access_restricted',
      sourceRef: { type: 'gate_event', id: target.runId },
      occurredAt: target.restrictedAt,
    });
    escalationId = recorded.escalationId;
    await GateRun.updateOne(
      { _id: run, escalationId: null },
      { $set: { escalationId: new Types.ObjectId(recorded.escalationId) } },
    );
  } catch (err) {
    errors.push(err);
  }

  try {
    await deps.risk?.recomputeForUser(target.userId, {
      type: 'critical_event',
      refId: target.runId,
    });
  } catch (err) {
    errors.push(err);
  }

  if (errors.length > 0 || escalationId === null) {
    throw errors[0] instanceof Error ? errors[0] : new Error('Restriction effects incomplete');
  }
  return { escalationId };
}

/** Set `User.gateRestriction`, once retried, and only while the run has not been restored. */
export async function setRestrictionFlag(target: RestrictionTarget): Promise<void> {
  const run = new Types.ObjectId(target.runId);
  if ((await GateRun.exists({ _id: run, restoredAt: null })) === null) return;
  const write = (): Promise<unknown> =>
    Employee.updateOne(
      { _id: new Types.ObjectId(target.userId) },
      { $set: { gateRestriction: { restrictedAt: target.restrictedAt, runId: run } } },
    );
  try {
    await write();
  } catch {
    await write();
  }
  // A restore may have completed between the check above and the write (P5-L5). Re-read and
  // compensate, so a restored employee is never left behind a stale cache entry.
  if ((await GateRun.exists({ _id: run, restoredAt: null })) === null) {
    await clearRestrictionFlag(target.userId, target.runId);
  }
}

/** Idempotency key of the gate.access_restored entry of one restore (run and claim time). */
export function restoreAuditKey(runId: string, restoredAt: Date): string {
  return `gate:restore:${runId}:${String(restoredAt.getTime())}`;
}

/** Clear the flag, but only the one that belongs to this run. */
export async function clearRestrictionFlag(userId: string, runId: string): Promise<void> {
  await Employee.updateOne(
    { _id: new Types.ObjectId(userId), 'gateRestriction.runId': new Types.ObjectId(runId) },
    { $set: { gateRestriction: null } },
  );
}
