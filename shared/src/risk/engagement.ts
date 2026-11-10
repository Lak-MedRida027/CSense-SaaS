import { roundHalfUp } from './math.js';

export interface EngagementFacts {
  /** Published modules in the employee curriculum. */
  moduleIds: readonly string[];
  /** Modules the employee has passed (may include modules outside the curriculum; ignored). */
  passedModuleIds: readonly string[];
  finalTestExists: boolean;
  finalTestPassed: boolean;
}

export interface EngagementSummary {
  /** Curriculum modules plus the final test, when it exists. */
  curriculumSize: number;
  completed: number;
  passedModules: number;
}

export function summariseEngagement(f: EngagementFacts): EngagementSummary {
  const inCurriculum = new Set(f.moduleIds);
  const passedModules = new Set(f.passedModuleIds.filter((id) => inCurriculum.has(id))).size;
  const finalCount = f.finalTestExists ? 1 : 0;
  return {
    curriculumSize: inCurriculum.size + finalCount,
    completed: passedModules + (f.finalTestExists && f.finalTestPassed ? 1 : 0),
    passedModules,
  };
}

/**
 * Engagement risk: the share of the current curriculum plus the final test that is not yet
 * completed. Null when there is nothing to complete.
 */
export function engagementScore(f: EngagementFacts): number | null {
  const s = summariseEngagement(f);
  if (s.curriculumSize === 0) return null;
  return roundHalfUp(100 * (s.curriculumSize - s.completed), s.curriculumSize);
}
