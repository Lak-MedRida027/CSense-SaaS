import { Types, trusted } from 'mongoose';
import {
  listAuditLogsQuerySchema,
  type AuditLogDTO,
  type AuditLogListDTO,
  type ListAuditLogsQuery,
} from '@csense/shared';
import { ADMIN_ONLY, defineRoute, type RouteDef } from '../../http/routeRegistry.js';
import { AuditLog, numericSeqFilter } from '../../models/index.js';

interface AuditRow {
  _id: Types.ObjectId;
  seq?: number | null;
  prevHash?: string | null;
  hash?: string | null;
  idempotencyKey?: string | null;
  action: AuditLogDTO['action'];
  outcome: AuditLogDTO['outcome'];
  severity?: AuditLogDTO['severity'] | null;
  actorId?: Types.ObjectId | null;
  actorRole?: AuditLogDTO['actorRole'];
  targetType?: AuditLogDTO['targetType'];
  targetId?: Types.ObjectId | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

/** Explicit field list: whatever else a document may carry never reaches a response. */
export function toAuditLogDTO(row: AuditRow): AuditLogDTO {
  return {
    id: row._id.toHexString(),
    seq: row.seq ?? null,
    action: row.action,
    outcome: row.outcome,
    severity: row.severity ?? 'info',
    actorId: row.actorId ? row.actorId.toHexString() : null,
    actorRole: row.actorRole ?? null,
    targetType: row.targetType ?? null,
    targetId: row.targetId ? row.targetId.toHexString() : null,
    ip: row.ip ?? null,
    userAgent: row.userAgent ?? null,
    requestId: row.requestId ?? null,
    metadata: row.metadata ?? {},
    prevHash: row.prevHash ?? null,
    hash: row.hash ?? null,
    idempotencyKey: row.idempotencyKey ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Newest first by sequence; `before` is an exclusive cursor. Only chained entries are listed. */
export async function listAuditLogs(query: ListAuditLogsQuery): Promise<AuditLogListDTO> {
  const filter: Record<string, unknown> = {};
  if (query.action) filter.action = query.action;
  if (query.severity) filter.severity = query.severity;
  if (query.outcome) filter.outcome = query.outcome;
  if (query.actorId) filter.actorId = new Types.ObjectId(query.actorId);
  if (query.targetType) filter.targetType = query.targetType;
  if (query.targetId) filter.targetId = new Types.ObjectId(query.targetId);
  if (query.from || query.to) {
    filter.createdAt = trusted({
      ...(query.from ? { $gte: new Date(query.from) } : {}),
      ...(query.to ? { $lte: new Date(query.to) } : {}),
    });
  }
  filter.seq =
    query.before === undefined
      ? numericSeqFilter()
      : trusted({ $type: 'number', $lt: query.before });

  const rows = await AuditLog.find(filter)
    .sort({ seq: -1 })
    .limit(query.limit + 1)
    .lean<AuditRow[]>();
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toAuditLogDTO),
    nextCursor: rows.length > query.limit && last?.seq ? last.seq : null,
  };
}

/** Read-only by construction: GET is the only method registered under /admin/audit-logs. */
export function auditLogRoutes(): RouteDef[] {
  return [
    defineRoute({
      method: 'get',
      path: '/admin/audit-logs',
      access: ADMIN_ONLY,
      schemas: { query: listAuditLogsQuerySchema },
      handler: (ctx) => listAuditLogs(ctx.query),
    }),
  ];
}
