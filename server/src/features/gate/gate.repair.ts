import { Types, trusted } from 'mongoose';
import { Employee, GateRun } from '../../models/index.js';
import type { EscalationService } from '../governance/escalation.service.js';
import type { GateRunRow } from './gate.mapper.js';
import { applyRestrictionEffects, clearRestrictionFlag } from './gate.restriction.js';

/** Upper bound of runs one sweep looks at for crashes that left no marker. */
export const GATE_SWEEP_LIMIT = 200;

/**
 * Reconcile's gate repair (ADR 0015, plan 6.7). `gateruns` is the record of truth; this rebuilds
 * what hangs off it:
 *  - the latest restricted, unrestored run: the user flag, the escalation (idempotent
 *    `recordCriticalEvent`) and the run's pointer to it;
 *  - a user flag whose run is restored or missing: cleared.
 * Returns whether anything was (or, in a dry run, would be) repaired. Risk is recomputed by the
 * caller's own risk step, which runs after this.
 */
export async function repairGate(
  deps: { escalations: Pick<EscalationService, 'recordCriticalEvent'> },
  userId: string,
  options: { dryRun?: boolean } = {},
): Promise<boolean> {
  const owner = new Types.ObjectId(userId);
  const employee = await Employee.findById(owner)
    .select('gateRestriction')
    .lean<{ gateRestriction?: { runId: Types.ObjectId } | null }>();
  if (!employee) return false;

  const run = await GateRun.findOne({ userId: owner, status: 'restricted', restoredAt: null })
    .sort({ closedAt: -1, _id: -1 })
    .lean<GateRunRow>();
  const flagged = employee.gateRestriction?.runId ?? null;

  if (!run) {
    if (!flagged) return false;
    if (options.dryRun !== true) await clearRestrictionFlag(userId, flagged.toHexString());
    return true;
  }

  const flagOk = flagged !== null && flagged.equals(run._id);
  const escalationOk = run.escalationId != null;
  if (flagOk && escalationOk) return false;
  if (options.dryRun === true) return true;

  await applyRestrictionEffects(
    { escalations: deps.escalations },
    { userId, runId: run._id.toHexString(), restrictedAt: run.closedAt ?? run.openedAt },
  );
  return true;
}

/**
 * Employees with a restricted, unrestored run that never got its escalation, for the sweeper
 * (a crash between the run write and the escalation leaves no marker). Bounded.
 */
export async function usersWithUnescalatedRestriction(
  olderThan: Date,
  limit = GATE_SWEEP_LIMIT,
): Promise<string[]> {
  const rows = await GateRun.find({
    status: 'restricted',
    restoredAt: null,
    escalationId: null,
    closedAt: trusted({ $lt: olderThan }),
  })
    .select('userId')
    .sort({ closedAt: 1 })
    .limit(limit)
    .lean<{ userId: Types.ObjectId }[]>();
  return [...new Set(rows.map((r) => r.userId.toHexString()))];
}
