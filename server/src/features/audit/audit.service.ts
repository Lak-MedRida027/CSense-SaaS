import { Types } from 'mongoose';
import type {
  AuditAction,
  AuditOutcome,
  AuditSeverity,
  AuditTargetType,
  Role,
} from '@csense/shared';
import { AuditLog } from '../../models/index.js';

/** Request-derived context attached to audit entries. */
export interface AuditContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

export interface AuditRecordInput {
  action: AuditAction;
  outcome: AuditOutcome;
  severity?: AuditSeverity;
  actor?: { id: string | Types.ObjectId; role: Role } | null;
  target?: { type: AuditTargetType; id: string | Types.ObjectId } | null;
  ctx?: AuditContext;
  metadata?: Record<string, unknown>;
}

const SECRET_KEY = /pass|token|secret|hash/i;

/** Drops secret-looking keys at any depth. Values are never inspected, only key names. */
export function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    return depth > 4 ? [] : value.map((v) => sanitizeMetadata(v, depth + 1));
  }
  if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
    if (depth > 4) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (!SECRET_KEY.test(k)) out[k] = sanitizeMetadata(v, depth + 1);
    }
    return out;
  }
  return value;
}

const toObjectId = (id: string | Types.ObjectId): Types.ObjectId =>
  typeof id === 'string' ? new Types.ObjectId(id) : id;

/**
 * Append one audit entry. Awaited by callers: if the write fails the request fails closed.
 * Never pass the email typed for an unknown account.
 */
export async function record(input: AuditRecordInput): Promise<void> {
  await AuditLog.create({
    action: input.action,
    outcome: input.outcome,
    severity: input.severity ?? 'info',
    actorId: input.actor ? toObjectId(input.actor.id) : null,
    actorRole: input.actor?.role ?? null,
    targetType: input.target?.type ?? null,
    targetId: input.target ? toObjectId(input.target.id) : null,
    ip: input.ctx?.ip?.slice(0, 64) ?? null,
    userAgent: input.ctx?.userAgent?.slice(0, 256) ?? null,
    requestId: input.ctx?.requestId?.slice(0, 64) ?? null,
    metadata: sanitizeMetadata(input.metadata ?? {}),
  });
}

export const audit = { record };
