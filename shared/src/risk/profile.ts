import {
  RISK_DIMENSIONS,
  RISK_MIN_FIRST_ATTEMPTS,
  RISK_MODEL_VERSION,
  type DimensionCoverage,
  type RiskDimension,
  type RiskLevel,
  type SimulationOutcome,
} from '../constants/risk.js';
import type { AssessmentKind } from '../constants/assessment.js';
import type { AttemptEndReason } from '../constants/learning.js';
import { behaviouralScore, summariseConduct } from './behavioural.js';
import { classifyRisk } from './classify.js';
import {
  computeComposite,
  effectiveWeights,
  type DimensionCoverageMap,
  type DimensionScores,
  type WeightsBp,
} from './composite.js';
import { engagementScore, summariseEngagement } from './engagement.js';
import { firstAttempts, knowledgeScore } from './knowledge.js';
import { simulationScore } from './simulation.js';

export interface RiskAttemptFact {
  assessmentId: string;
  kind: AssessmentKind;
  attemptNumber: number;
  /** ISO-8601. */
  attemptedAt: string;
  endReason: AttemptEndReason;
  passed: boolean;
  correctCount: number;
  totalCount: number;
}

export interface RiskFacts {
  attempts: readonly RiskAttemptFact[];
  curriculum: {
    moduleIds: readonly string[];
    passedModuleIds: readonly string[];
    finalTestExists: boolean;
    finalTestPassed: boolean;
  };
  /** Cooldowns started after repeated failed attempts (audit entries), any assessment. */
  cooldowns: readonly { assessmentId: string; at: string }[];
  simulation: {
    enabled: boolean;
    outcomes: readonly { outcome: SimulationOutcome; occurredAt: string }[];
  };
  /** Phase 5 widens this to the gate signals. */
  gate: null;
}

export interface RiskEvidence {
  attempts: number;
  firstAttempts: number;
  abandoned: number;
  expired: number;
  extraFailures: number;
  cooldowns: number;
  passedModules: number;
  curriculumSize: number;
  finalTestPassed: boolean;
  simulationOutcomes: number;
}

export interface RiskResult {
  modelVersion: number;
  scores: DimensionScores;
  coverage: DimensionCoverageMap;
  effectiveWeightsBp: WeightsBp;
  compositeScore: number | null;
  riskLevel: RiskLevel | null;
  /** False until there is enough first-attempt evidence to classify the employee (D4-12). */
  assessed: boolean;
  evidence: RiskEvidence;
}

/**
 * The whole risk model v1 as one pure function of facts (ADR 0010). Higher means riskier. The
 * result does not depend on the order of the input attempts.
 */
export function computeRiskProfile(facts: RiskFacts): RiskResult {
  const scores: DimensionScores = {
    knowledge: knowledgeScore(facts.attempts),
    behavioural: behaviouralScore(facts.attempts, facts.cooldowns.length),
    simulation: facts.simulation.enabled ? simulationScore(facts.simulation.outcomes) : null,
    engagement: engagementScore(facts.curriculum),
  };
  const coverage = {} as Record<RiskDimension, DimensionCoverage>;
  for (const d of RISK_DIMENSIONS) {
    coverage[d] =
      d === 'simulation' && !facts.simulation.enabled
        ? 'disabled'
        : scores[d] === null
          ? 'not_assessed'
          : 'assessed';
  }

  const engagement = summariseEngagement(facts.curriculum);
  const conduct = summariseConduct(facts.attempts);
  const firstAssessments = new Set(firstAttempts(facts.attempts).map((a) => a.assessmentId));
  const needed = Math.max(1, Math.min(RISK_MIN_FIRST_ATTEMPTS, engagement.curriculumSize));
  const assessed = scores.knowledge !== null && firstAssessments.size >= needed;

  const composite = assessed ? computeComposite(scores, coverage) : null;
  return {
    modelVersion: RISK_MODEL_VERSION,
    scores,
    coverage,
    effectiveWeightsBp: effectiveWeights(scores, coverage),
    compositeScore: composite,
    riskLevel: composite === null ? null : classifyRisk(composite),
    assessed,
    evidence: {
      attempts: facts.attempts.length,
      firstAttempts: firstAssessments.size,
      abandoned: facts.attempts.filter((a) => a.endReason === 'abandoned').length,
      expired: facts.attempts.filter((a) => a.endReason === 'expired').length,
      extraFailures: conduct.extraFailures,
      cooldowns: facts.cooldowns.length,
      passedModules: engagement.passedModules,
      curriculumSize: engagement.curriculumSize,
      finalTestPassed: facts.curriculum.finalTestExists && facts.curriculum.finalTestPassed,
      simulationOutcomes: facts.simulation.outcomes.length,
    },
  };
}
