import { RISK_LEVELS, type RiskLevel } from '../constants/risk.js';

export interface RiskTransition {
  levelChanged: boolean;
  direction: 'up' | 'down' | 'none';
  /** Entering High from any other state (including unassessed). */
  escalate: boolean;
  auditSeverity: 'info' | 'warning';
}

const rank = (level: RiskLevel | null): number =>
  level === null ? -1 : RISK_LEVELS.indexOf(level);

/**
 * What a change of level means for governance (D4-13): only entering High escalates. A move up to
 * Medium or High is audited as a warning; every other change (a move down, or the first
 * classification of an employee as Low) is audited as info.
 */
export function decideRiskTransition(
  prev: RiskLevel | null,
  next: RiskLevel | null,
): RiskTransition {
  const levelChanged = prev !== next;
  const direction = !levelChanged ? 'none' : rank(next) > rank(prev) ? 'up' : 'down';
  return {
    levelChanged,
    direction,
    escalate: next === 'High' && prev !== 'High',
    auditSeverity: direction === 'up' && next !== 'Low' ? 'warning' : 'info',
  };
}
