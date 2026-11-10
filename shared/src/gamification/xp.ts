import type { AttemptEndReason } from '../constants/learning.js';
import { XP_RULES, type XpSource } from '../constants/gamification.js';
import { GATE_XP_KEY_PREFIX, type GateRunStatus } from '../constants/gate.js';
import { orgLocalDate } from '../gate/time.js';

/** One stored attempt, reduced to what the XP rules need. */
export interface AttemptFact {
  attemptId: string;
  attemptNumber: number;
  endReason: AttemptEndReason;
  score: number;
  passed: boolean;
}

export interface ModuleXpFacts {
  moduleId: string;
  firstAttempt: AttemptFact | null;
  /** The first attempt, whatever its end reason (the lowest attempt number). */
  passingAttempt: AttemptFact | null;
  /** Exercises whose first answer was correct. */
  practiceFirstTryCorrect: number;
}

/** One closed gate run, reduced to what the gate XP rule needs. */
export interface GateXpRunFact {
  runId: string;
  status: Extract<GateRunStatus, 'passed' | 'restricted'>;
  firstAnswerCorrect: boolean;
  /** ISO-8601. */
  closedAt: string;
}

export interface XpFacts {
  modules: readonly ModuleXpFacts[];
  /** Closed gate runs (ADR 0017). Absent or empty: no gate XP. */
  gate?: { runs: readonly GateXpRunFact[] } | undefined;
  finalTest: {
    firstAttempt: AttemptFact | null;
    passingAttempt: AttemptFact | null;
  } | null;
}

export interface XpEntry {
  key: string;
  source: XpSource;
  amount: number;
  moduleId: string | null;
  attemptId: string;
}

export interface XpResult {
  total: number;
  entries: XpEntry[];
}

function passingOnly(a: AttemptFact | null): AttemptFact | null {
  // A failed, abandoned or expired attempt never earns anything, whatever the caller passed in.
  return a !== null && a.passed && a.endReason === 'submitted' ? a : null;
}

/**
 * XP is a pure function of attempt facts. Every entry has a unique key, so duplicated or reordered
 * facts give the same result, and retries cannot farm XP: the completion keys exist once per module.
 */
export function computeXp(facts: XpFacts, options: { timeZone?: string } = {}): XpResult {
  const byKey = new Map<string, XpEntry>();
  const add = (entry: XpEntry): void => {
    if (entry.amount > 0 && !byKey.has(entry.key)) byKey.set(entry.key, entry);
  };

  for (const m of facts.modules) {
    const pass = passingOnly(m.passingAttempt);
    if (!pass) continue;
    const base = { moduleId: m.moduleId, attemptId: pass.attemptId };
    const key = (suffix: string): string => `module:${m.moduleId}:${suffix}`;
    add({
      key: key('completion'),
      source: 'module_completion',
      amount: XP_RULES.moduleCompletion,
      ...base,
    });
    if (m.firstAttempt?.attemptId === pass.attemptId) {
      add({
        key: key('first_try'),
        source: 'module_first_try',
        amount: XP_RULES.moduleFirstTry,
        ...base,
      });
    }
    if (pass.score === 100) {
      add({
        key: key('perfect'),
        source: 'module_perfect',
        amount: XP_RULES.modulePerfect,
        ...base,
      });
    }
    const practice = Math.max(0, Math.floor(m.practiceFirstTryCorrect));
    add({
      key: key('practice'),
      source: 'module_practice',
      amount: XP_RULES.modulePracticeEach * practice,
      ...base,
    });
  }

  const finalPass = passingOnly(facts.finalTest?.passingAttempt ?? null);
  if (finalPass) {
    const base = { moduleId: null, attemptId: finalPass.attemptId };
    add({
      key: 'final:completion',
      source: 'final_completion',
      amount: XP_RULES.finalCompletion,
      ...base,
    });
    if (facts.finalTest?.firstAttempt?.attemptId === finalPass.attemptId) {
      add({
        key: 'final:first_try',
        source: 'final_first_try',
        amount: XP_RULES.finalFirstTry,
        ...base,
      });
    }
    if (finalPass.score === 100) {
      add({
        key: 'final:perfect',
        source: 'final_perfect',
        amount: XP_RULES.finalPerfect,
        ...base,
      });
    }
  }

  // Gate XP (ADR 0017): one entry per organisation-local day with a passed run whose first answer
  // was correct. The earliest such run of the day owns the entry, whatever the input order.
  const timeZone = options.timeZone ?? 'UTC';
  const earliestPerDay = new Map<string, GateXpRunFact>();
  for (const run of facts.gate?.runs ?? []) {
    if (run.status !== 'passed' || !run.firstAnswerCorrect) continue;
    const day = orgLocalDate(run.closedAt, timeZone);
    const held = earliestPerDay.get(day);
    const older =
      held === undefined ||
      Date.parse(run.closedAt) < Date.parse(held.closedAt) ||
      (Date.parse(run.closedAt) === Date.parse(held.closedAt) && run.runId < held.runId);
    if (older) earliestPerDay.set(day, run);
  }
  for (const [day, run] of earliestPerDay) {
    add({
      key: `${GATE_XP_KEY_PREFIX}${day}`,
      source: 'gate_daily_check',
      amount: XP_RULES.gateDailyCheck,
      moduleId: null,
      attemptId: run.runId,
    });
  }

  const entries = [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { total: entries.reduce((sum, e) => sum + e.amount, 0), entries };
}

/** The XP that one attempt (the passing one) is responsible for. */
export function xpEarnedForAttempt(result: XpResult, attemptId: string): number {
  return result.entries.filter((e) => e.attemptId === attemptId).reduce((s, e) => s + e.amount, 0);
}
