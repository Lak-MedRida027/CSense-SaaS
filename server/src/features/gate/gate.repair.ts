import { Types, trusted } from 'mongoose';
import { AuditLog, Employee, GateRun } from '../../models/index.js';
import { audit } from '../audit/audit.service.js';
import type { EscalationService } from '../governance/escalation.service.js';
import type { GateRunRow } from './gate.mapper.js';
import {
  applyRestrictionEffects,
  clearRestrictionFlag,
  restoreAuditKey,
} from './gate.restriction.js';

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
    // Access must never return without its record (P5-L4): a restored run without its
    // gate.access_restored entry gets it written BEFORE the flag is cleared. The entry is
    // attributed to restoredBy and flagged as repaired.
    const missingAudit = await restoredRunWithoutAudit(owner);
    if (missingAudit && options.dryRun !== true) await writeRestoreAudit(missingAudit);
    if (!flagged) return missingAudit !== null;
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

/** The employee's latest restored run when its gate.access_restored entry does not exist. */
async function restoredRunWithoutAudit(owner: Types.ObjectId): Promise<GateRunRow | null> {
  const restored = await GateRun.findOne({
    userId: owner,
    status: 'restricted',
    restoredAt: trusted({ $ne: null }),
  })
    .sort({ restoredAt: -1, _id: -1 })
    .lean<GateRunRow>();
  if (!restored?.restoredAt || !restored.restoredBy) return null;
  const key = restoreAuditKey(restored._id.toHexString(), restored.restoredAt);
  return (await AuditLog.exists({ idempotencyKey: key })) === null ? restored : null;
}

async function writeRestoreAudit(run: GateRunRow): Promise<void> {
  if (!run.restoredAt || !run.restoredBy) return;
  await audit.record({
    action: 'gate.access_restored',
    outcome: 'success',
    severity: 'warning',
    actor: { id: run.restoredBy, role: 'administrator' },
    target: { type: 'user', id: run.userId },
    idempotencyKey: restoreAuditKey(run._id.toHexString(), run.restoredAt),
    at: run.restoredAt,
    metadata: {
      runId: run._id.toHexString(),
      escalationId: run.escalationId?.toHexString() ?? null,
      repaired: true,
    },
  });
}

const STALE_FLAG_LOOKBACK_MS = 30 * 86_400_000;

/**
 * Employees the sweeper should reconcile for the gate (bounded, indexed; ADR 0015):
 *  - restricted, unrestored runs older than `olderThan` whose employee lacks the matching
 *    `gateRestriction` flag, or whose escalation was never recorded (P5-L6), paged by run id;
 *  - employees whose flag still points at a run restored in the last 30 days (P5-L3).
 * `next` is the cursor for the first scan; null when it reached the end.
 */
export async function usersNeedingGateRepair(
  olderThan: Date,
  page: { afterId: string | null; pageSize?: number },
  now: Date,
): Promise<{ userIds: string[]; next: string | null }> {
  const pageSize = page.pageSize ?? GATE_SWEEP_LIMIT;
  const found = new Set<string>();

  const runs = await GateRun.find({
    status: 'restricted',
    restoredAt: null,
    closedAt: trusted({ $lt: olderThan }),
    ...(page.afterId ? { _id: trusted({ $gt: new Types.ObjectId(page.afterId) }) } : {}),
  })
    .sort({ _id: 1 })
    .limit(pageSize)
    .select('userId escalationId')
    .lean<
      { _id: Types.ObjectId; userId: Types.ObjectId; escalationId?: Types.ObjectId | null }[]
    >();
  if (runs.length > 0) {
    const owners = await Employee.find({ _id: trusted({ $in: runs.map((r) => r.userId) }) })
      .select('gateRestriction')
      .lean<{ _id: Types.ObjectId; gateRestriction?: { runId: Types.ObjectId } | null }[]>();
    const flagOf = new Map(owners.map((o) => [o._id.toHexString(), o.gateRestriction?.runId]));
    for (const r of runs) {
      const flag = flagOf.get(r.userId.toHexString());
      if (r.escalationId == null || !flag || !flag.equals(r._id)) found.add(r.userId.toHexString());
    }
  }

  const restored = await GateRun.find({
    status: 'restricted',
    restoredAt: trusted({ $gt: new Date(now.getTime() - STALE_FLAG_LOOKBACK_MS) }),
  })
    .sort({ restoredAt: -1 })
    .limit(pageSize)
    .select('_id')
    .lean<{ _id: Types.ObjectId }[]>();
  if (restored.length > 0) {
    const stale = await Employee.find({
      'gateRestriction.runId': trusted({ $in: restored.map((r) => r._id) }),
    })
      .select('_id')
      .limit(pageSize)
      .lean<{ _id: Types.ObjectId }[]>();
    for (const u of stale) found.add(u._id.toHexString());
  }

  const last = runs.at(-1);
  return {
    userIds: [...found],
    next: runs.length === pageSize && last ? last._id.toHexString() : null,
  };
}
