import type { ProgressStatus } from '../constants/enums.js';

/**
 * Pure progression rules (ADR 0006). Lock state is never stored: it is derived from the current
 * curriculum and the employee's pass facts, so it stays true under any admin content change.
 */
export interface CurriculumModule {
  id: string;
  order: number;
}

export interface ModuleFacts {
  started: boolean;
  passed: boolean;
}

export interface DerivedModuleState {
  moduleId: string;
  /** 1-based position within the curriculum. */
  position: number;
  status: ProgressStatus;
  /** The frontier module that blocks this one, when locked. */
  lockedBy: string | null;
}

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Strict prefix rule: a module is accessible iff every module before it (in `order`, ties broken by
 * id) is passed. The first unpassed module is the frontier. Passed modules are `completed`
 * wherever they sit. Facts for ids that are not in `modules` (unpublished) are ignored.
 */
export function deriveModuleStates(
  modules: readonly CurriculumModule[],
  facts: ReadonlyMap<string, ModuleFacts>,
): DerivedModuleState[] {
  const sorted = [...modules].sort((a, b) => a.order - b.order || compareIds(a.id, b.id));
  const frontier = sorted.find((m) => facts.get(m.id)?.passed !== true)?.id ?? null;

  return sorted.map((m, index): DerivedModuleState => {
    const fact = facts.get(m.id);
    const position = index + 1;
    if (fact?.passed === true) {
      return { moduleId: m.id, position, status: 'completed', lockedBy: null };
    }
    if (m.id === frontier) {
      return {
        moduleId: m.id,
        position,
        status: fact?.started === true ? 'in_progress' : 'unlocked',
        lockedBy: null,
      };
    }
    return { moduleId: m.id, position, status: 'locked', lockedBy: frontier };
  });
}

/** The final test opens only when the curriculum is non-empty and every module is passed. */
export function deriveFinalTestState(
  states: readonly DerivedModuleState[],
  final: { passed: boolean; started: boolean },
): { status: ProgressStatus; remainingModules: number } {
  const remainingModules = states.filter((s) => s.status !== 'completed').length;
  if (final.passed) return { status: 'completed', remainingModules };
  if (states.length === 0 || remainingModules > 0) return { status: 'locked', remainingModules };
  return { status: final.started ? 'in_progress' : 'unlocked', remainingModules };
}

export function isModuleAccessible(state: DerivedModuleState): boolean {
  return state.status !== 'locked';
}
