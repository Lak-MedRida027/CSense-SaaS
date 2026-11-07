import type {
  AuditAction,
  AuditOutcome,
  AuditSeverity,
  AuditTargetType,
} from '../constants/audit.js';
import type { Role } from '../constants/roles.js';

export interface AuditLogDTO {
  id: string;
  action: AuditAction;
  outcome: AuditOutcome;
  severity: AuditSeverity;
  actorId: string | null;
  actorRole: Role | null;
  targetType: AuditTargetType | null;
  targetId: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}
