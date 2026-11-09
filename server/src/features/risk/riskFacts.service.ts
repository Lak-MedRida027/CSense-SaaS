import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import type { AttemptEndReason, RiskFacts } from '@csense/shared';
import { AuditLog, FinalTest, QuizAttempt, numericSeqFilter } from '../../models/index.js';
import { stableStringify } from '../audit/chain.js';
import { curriculumFor } from '../learning/curriculum.service.js';

interface AttemptRow {
  type: 'Quiz' | 'FinalTest';
  refId: Types.ObjectId;
  moduleId?: Types.ObjectId | null | undefined;
  attemptNumber: number;
  endReason: AttemptEndReason;
  passed: boolean;
  correctCount: number;
  totalCount: number;
  attemptedAt: Date;
}

const MAX_ATTEMPTS = 5000;
const MAX_COOLDOWNS = 500;

/**
 * Everything the risk model reads, loaded fresh from the database (ADR 0010). The profile is a
 * pure function of these facts, so a recompute at any time gives the same answer.
 * Cooldowns come from the `learning.assessment.cooldown` audit entries written by Phase 3.
 */
export async function loadRiskFacts(
  userId: string,
  options: { phishingEnabled: boolean },
): Promise<RiskFacts> {
  const owner = new Types.ObjectId(userId);
  const [curriculum, rows, finalExists, cooldownRows] = await Promise.all([
    curriculumFor(userId),
    QuizAttempt.find({ userId: owner })
      .select(
        'type refId moduleId attemptNumber endReason passed correctCount totalCount attemptedAt',
      )
      .sort({ _id: 1 })
      .limit(MAX_ATTEMPTS)
      .lean<AttemptRow[]>(),
    FinalTest.exists({}),
    AuditLog.find({
      action: 'learning.assessment.cooldown',
      targetId: owner,
      // Only chained entries count: a row without a numeric seq is not evidence.
      seq: numericSeqFilter(),
    })
      .select('metadata.assessmentId createdAt')
      .sort({ createdAt: -1, _id: -1 })
      .limit(MAX_COOLDOWNS)
      .lean<{ metadata?: { assessmentId?: unknown }; createdAt: Date }[]>(),
  ]);

  const passedModules = new Set<string>();
  let finalTestPassed = false;
  for (const row of rows) {
    if (!row.passed) continue;
    if (row.type === 'FinalTest') finalTestPassed = true;
    else if (row.moduleId) passedModules.add(row.moduleId.toHexString());
  }

  return {
    attempts: rows.map((r) => ({
      assessmentId: r.refId.toHexString(),
      kind: r.type,
      attemptNumber: r.attemptNumber,
      attemptedAt: r.attemptedAt.toISOString(),
      endReason: r.endReason,
      passed: r.passed,
      correctCount: r.correctCount,
      totalCount: r.totalCount,
    })),
    curriculum: {
      moduleIds: curriculum.map((c) => c.id),
      passedModuleIds: [...passedModules],
      finalTestExists: finalExists !== null,
      finalTestPassed,
    },
    cooldowns: [...cooldownRows].reverse().map((c) => ({
      assessmentId: typeof c.metadata?.assessmentId === 'string' ? c.metadata.assessmentId : '',
      at: c.createdAt.toISOString(),
    })),
    simulation: { enabled: options.phishingEnabled, outcomes: [] },
    gate: null,
  };
}

/** SHA-256 over a canonical form with the order-insensitive lists sorted. */
export function digestFacts(facts: RiskFacts): string {
  const canonical = {
    ...facts,
    attempts: [...facts.attempts].sort(
      (a, b) =>
        a.assessmentId.localeCompare(b.assessmentId) ||
        a.attemptNumber - b.attemptNumber ||
        a.attemptedAt.localeCompare(b.attemptedAt),
    ),
    curriculum: {
      ...facts.curriculum,
      moduleIds: [...facts.curriculum.moduleIds].sort(),
      passedModuleIds: [...facts.curriculum.passedModuleIds].sort(),
    },
    cooldowns: [...facts.cooldowns].sort((a, b) => a.at.localeCompare(b.at)),
  };
  return createHash('sha256').update(stableStringify(canonical)).digest('hex');
}
