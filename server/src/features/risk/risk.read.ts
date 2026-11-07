import { Types } from 'mongoose';
import {
  RISK_LEVEL_TO_STATE,
  RISK_WEIGHTS_BP,
  type DimensionCoverage,
  type DimensionCoverageMap,
  type ListRiskProfilesQuery,
  type RiskAssessmentDTO,
  type RiskLevel,
  type RiskProfileDetailDTO,
  type RiskProfileListDTO,
  type RiskProfileSummaryDTO,
} from '@csense/shared';
import { notFoundError } from '../../lib/httpError.js';
import { Employee, Escalation, RiskAssessment, RiskProfile } from '../../models/index.js';
import { toSummaries } from '../governance/escalation.read.js';
import type { EscalationRow } from '../governance/escalation.service.js';

interface ProfileRow {
  knowledgeScore?: number | null;
  behaviouralScore?: number | null;
  simulationScore?: number | null;
  engagementScore?: number | null;
  compositeScore?: number | null;
  riskLevel?: RiskLevel | null;
  coverage?: DimensionCoverageMap | null;
  effectiveWeightsBp?: {
    knowledge: number;
    behavioural: number;
    simulation: number;
    engagement: number;
  } | null;
  evidence?: Record<string, unknown> | null;
  modelVersion?: number | null;
  computedAt?: Date | null;
}

interface PersonRow {
  _id: Types.ObjectId;
  name: string;
  department?: string | null;
  isActive: boolean;
}

const NOT_ASSESSED: DimensionCoverageMap = {
  knowledge: 'not_assessed',
  behavioural: 'not_assessed',
  simulation: 'not_assessed',
  engagement: 'not_assessed',
};

function summaryOf(person: PersonRow, profile: ProfileRow | null): RiskProfileSummaryDTO {
  const level = profile?.riskLevel ?? null;
  return {
    userId: person._id.toHexString(),
    name: person.name,
    department: person.department ?? null,
    isActive: person.isActive,
    compositeScore: profile?.compositeScore ?? null,
    riskLevel: level,
    governanceState: level ? RISK_LEVEL_TO_STATE[level] : null,
    scores: {
      knowledge: profile?.knowledgeScore ?? null,
      behavioural: profile?.behaviouralScore ?? null,
      simulation: profile?.simulationScore ?? null,
      engagement: profile?.engagementScore ?? null,
    },
    coverage: profile?.coverage
      ? {
          knowledge: profile.coverage.knowledge,
          behavioural: profile.coverage.behavioural,
          simulation: profile.coverage.simulation,
          engagement: profile.coverage.engagement,
        }
      : NOT_ASSESSED,
    computedAt: profile?.computedAt ? profile.computedAt.toISOString() : null,
  };
}

const SORTS = {
  composite_desc: { unassessed: 1, 'p.compositeScore': -1, name: 1, _id: 1 },
  composite_asc: { unassessed: 1, 'p.compositeScore': 1, name: 1, _id: 1 },
  name_asc: { name: 1, _id: 1 },
  computed_desc: { 'p.computedAt': -1, name: 1, _id: 1 },
} as const;

/** Employees joined with their stored profile. Read-only: it never recomputes. */
export async function listRiskProfiles(query: ListRiskProfilesQuery): Promise<RiskProfileListDTO> {
  const match: Record<string, unknown> = { role: 'employee' };
  if (query.department) match.department = query.department;
  const levelMatch: Record<string, unknown> =
    query.level === undefined
      ? {}
      : query.level === 'unassessed'
        ? { $or: [{ p: null }, { 'p.riskLevel': null }] }
        : { 'p.riskLevel': query.level };

  const base = [
    { $match: match },
    {
      $lookup: {
        from: RiskProfile.collection.collectionName,
        localField: '_id',
        foreignField: 'userId',
        as: 'p',
      },
    },
    { $addFields: { p: { $first: '$p' } } },
    {
      $addFields: {
        unassessed: { $cond: [{ $eq: [{ $ifNull: ['$p.compositeScore', null] }, null] }, 1, 0] },
      },
    },
    ...(Object.keys(levelMatch).length > 0 ? [{ $match: levelMatch }] : []),
  ];
  const [facet] = await Employee.aggregate<{
    rows: (PersonRow & { p?: ProfileRow | null })[];
    total: { n: number }[];
  }>([
    ...base,
    {
      $facet: {
        rows: [
          { $sort: SORTS[query.sort] },
          { $skip: (query.page - 1) * query.pageSize },
          { $limit: query.pageSize },
          { $project: { name: 1, department: 1, isActive: 1, p: 1 } },
        ],
        total: [{ $count: 'n' }],
      },
    },
  ]);
  return {
    items: (facet?.rows ?? []).map((r) => summaryOf(r, r.p ?? null)),
    page: query.page,
    pageSize: query.pageSize,
    total: facet?.total[0]?.n ?? 0,
  };
}

export async function getRiskProfileDetail(userId: string): Promise<RiskProfileDetailDTO> {
  const owner = new Types.ObjectId(userId);
  // Employee only: an administrator id (or any unknown id) is a 404.
  const person = await Employee.findById(owner)
    .select('name department isActive')
    .lean<PersonRow>();
  if (!person) throw notFoundError();

  const [profile, history, active, resolved] = await Promise.all([
    RiskProfile.findOne({ userId: owner }).lean<ProfileRow>(),
    RiskAssessment.find({ userId: owner }).sort({ computedAt: -1, _id: -1 }).limit(20).lean(),
    Escalation.find({ userId: owner, active: true }).sort({ openedAt: -1 }).lean<EscalationRow[]>(),
    Escalation.find({ userId: owner, active: false })
      .sort({ openedAt: -1 })
      .limit(5)
      .lean<EscalationRow[]>(),
  ]);

  const evidence = profile?.evidence;
  const historyDto: RiskAssessmentDTO[] = history.map((h) => ({
    id: h._id.toHexString(),
    computedAt: h.computedAt.toISOString(),
    modelVersion: h.modelVersion,
    compositeScore: h.compositeScore ?? null,
    riskLevel: h.riskLevel ?? null,
    previousLevel: h.previousLevel ?? null,
    levelChanged: h.levelChanged,
    scores: {
      knowledge: h.scores.knowledge ?? null,
      behavioural: h.scores.behavioural ?? null,
      simulation: h.scores.simulation ?? null,
      engagement: h.scores.engagement ?? null,
    },
    coverage: {
      knowledge: h.coverage.knowledge as DimensionCoverage,
      behavioural: h.coverage.behavioural as DimensionCoverage,
      simulation: h.coverage.simulation as DimensionCoverage,
      engagement: h.coverage.engagement as DimensionCoverage,
    },
    trigger: {
      type: h.trigger.type,
      refId: h.trigger.refId ? h.trigger.refId.toHexString() : null,
    },
  }));

  return {
    profile: {
      ...summaryOf(person, profile),
      modelVersion: profile?.modelVersion ?? null,
      effectiveWeightsBp: profile?.effectiveWeightsBp
        ? {
            knowledge: profile.effectiveWeightsBp.knowledge,
            behavioural: profile.effectiveWeightsBp.behavioural,
            simulation: profile.effectiveWeightsBp.simulation,
            engagement: profile.effectiveWeightsBp.engagement,
          }
        : null,
      nominalWeightsBp: { ...RISK_WEIGHTS_BP },
      evidence: evidence
        ? {
            attempts: Number(evidence.attempts),
            firstAttempts: Number(evidence.firstAttempts),
            abandoned: Number(evidence.abandoned),
            expired: Number(evidence.expired),
            extraFailures: Number(evidence.extraFailures),
            cooldowns: Number(evidence.cooldowns),
            passedModules: Number(evidence.passedModules),
            curriculumSize: Number(evidence.curriculumSize),
            finalTestPassed: evidence.finalTestPassed === true,
            simulationOutcomes: Number(evidence.simulationOutcomes),
          }
        : null,
    },
    history: historyDto,
    escalations: await toSummaries([...active, ...resolved]),
  };
}
