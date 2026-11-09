import { Types } from 'mongoose';
import type {
  EscalationDetailDTO,
  EscalationListDTO,
  EscalationSummaryDTO,
  ListEscalationsQuery,
} from '@csense/shared';
import { notFoundError } from '../../lib/httpError.js';
import { Escalation } from '../../models/index.js';
import { loadUserLabels } from '../users/userLookup.js';
import type { EscalationRow } from './escalation.service.js';

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const hex = (id: Types.ObjectId | null | undefined): string | null =>
  id ? id.toHexString() : null;

/** Explicit whitelist mapping: no document field reaches a response unless it is named here. */
export async function toSummaries(rows: readonly EscalationRow[]): Promise<EscalationSummaryDTO[]> {
  const labels = await loadUserLabels(
    rows.flatMap((r) => [r.userId, ...(r.assigneeId ? [r.assigneeId] : [])]),
  );
  return rows.map((r) => {
    const subject = labels.get(r.userId.toHexString());
    const assignee = r.assigneeId ? labels.get(r.assigneeId.toHexString()) : undefined;
    return {
      id: r._id.toHexString(),
      reason: r.reason,
      severity: r.severity,
      reviewTier: r.reviewTier,
      status: r.status,
      subject: {
        userId: r.userId.toHexString(),
        name: subject?.name ?? 'Unknown employee',
        department: subject?.department ?? null,
      },
      riskLevel: r.context.riskLevel ?? null,
      compositeScore: r.context.compositeScore ?? null,
      openedAt: r.openedAt.toISOString(),
      acknowledgedAt: iso(r.acknowledgedAt),
      resolvedAt: iso(r.resolvedAt),
      assignee: r.assigneeId
        ? { id: r.assigneeId.toHexString(), name: assignee?.name ?? 'Unknown' }
        : null,
      version: r.version,
      retriggerCount: r.retriggerCount ?? 0,
      lastRetriggeredAt: iso(r.lastRetriggeredAt),
    };
  });
}

export async function toDetail(row: EscalationRow): Promise<EscalationDetailDTO> {
  const [summary] = await toSummaries([row]);
  if (!summary) throw notFoundError();
  const labels = await loadUserLabels(row.events.flatMap((e) => (e.actorId ? [e.actorId] : [])));
  const scores = row.context.scores;
  return {
    ...summary,
    context: {
      riskLevel: row.context.riskLevel ?? null,
      previousLevel: row.context.previousLevel ?? null,
      compositeScore: row.context.compositeScore ?? null,
      scores: scores
        ? {
            knowledge: scores.knowledge ?? null,
            behavioural: scores.behavioural ?? null,
            simulation: scores.simulation ?? null,
            engagement: scores.engagement ?? null,
          }
        : null,
      coverage: row.context.coverage
        ? {
            knowledge: row.context.coverage.knowledge,
            behavioural: row.context.coverage.behavioural,
            simulation: row.context.coverage.simulation,
            engagement: row.context.coverage.engagement,
          }
        : null,
      riskAssessmentId: hex(row.context.riskAssessmentId),
      modelVersion: row.context.modelVersion ?? null,
    },
    sourceRef: { type: row.sourceRef.type, id: row.sourceRef.id.toHexString() },
    resolution: row.resolution ?? null,
    managementReference: row.managementReference ?? null,
    events: row.events.map((e) => ({
      eventId: e.eventId.toHexString(),
      type: e.type,
      at: e.at.toISOString(),
      actor:
        e.actorId && e.actorRole
          ? {
              id: e.actorId.toHexString(),
              name: labels.get(e.actorId.toHexString())?.name ?? 'Unknown',
              role: e.actorRole,
            }
          : null,
      fromStatus: e.fromStatus ?? null,
      toStatus: e.toStatus ?? null,
      note: e.note ?? null,
      resolution: e.resolution ?? null,
    })),
  };
}

export async function listEscalations(query: ListEscalationsQuery): Promise<EscalationListDTO> {
  const filter: Record<string, unknown> = {};
  if (query.status === 'active') filter.active = true;
  else if (query.status) filter.status = query.status;
  if (query.severity) filter.severity = query.severity;
  if (query.reason) filter.reason = query.reason;
  if (query.userId) filter.userId = new Types.ObjectId(query.userId);

  const [rows, total, open, acknowledged] = await Promise.all([
    Escalation.find(filter)
      // 'critical' sorts before 'elevated', so ascending puts the most severe first.
      .sort({ severity: 1, openedAt: -1, _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<EscalationRow[]>(),
    Escalation.countDocuments(filter),
    Escalation.countDocuments({ status: 'open' }),
    Escalation.countDocuments({ status: 'acknowledged' }),
  ]);
  return {
    items: await toSummaries(rows),
    page: query.page,
    pageSize: query.pageSize,
    total,
    counts: { open, acknowledged },
  };
}

export async function getEscalation(id: string): Promise<EscalationDetailDTO> {
  const row = await Escalation.findById(id).lean<EscalationRow>();
  if (!row) throw notFoundError();
  return toDetail(row);
}
