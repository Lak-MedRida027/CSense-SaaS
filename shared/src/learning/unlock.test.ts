import { describe, expect, it } from 'vitest';
import {
  deriveFinalTestState,
  deriveModuleStates,
  isModuleAccessible,
  type CurriculumModule,
  type ModuleFacts,
} from './unlock.js';

const mods = (...orders: number[]): CurriculumModule[] =>
  orders.map((order, i) => ({ id: `m${String(i + 1)}`, order }));

const facts = (entries: Record<string, Partial<ModuleFacts>>): Map<string, ModuleFacts> =>
  new Map(Object.entries(entries).map(([id, f]) => [id, { started: false, passed: false, ...f }]));

const statuses = (m: CurriculumModule[], f: Map<string, ModuleFacts>) =>
  deriveModuleStates(m, f).map((s) => s.status);

describe('deriveModuleStates', () => {
  it('UL1: with no progress only position 1 is unlocked and the rest point at it', () => {
    const states = deriveModuleStates(mods(1, 2, 3), new Map());
    expect(states.map((s) => s.status)).toEqual(['unlocked', 'locked', 'locked']);
    expect(states.map((s) => s.position)).toEqual([1, 2, 3]);
    expect(states[0]?.lockedBy).toBeNull();
    expect(states[1]?.lockedBy).toBe('m1');
    expect(states[2]?.lockedBy).toBe('m1');
  });

  it('UL2: a started frontier is in_progress', () => {
    expect(statuses(mods(1, 2), facts({ m1: { started: true } }))).toEqual([
      'in_progress',
      'locked',
    ]);
  });

  it('UL3: passing N makes N+1 the frontier and nothing beyond unlocks', () => {
    const states = deriveModuleStates(mods(1, 2, 3), facts({ m1: { passed: true } }));
    expect(states.map((s) => s.status)).toEqual(['completed', 'unlocked', 'locked']);
    expect(states[2]?.lockedBy).toBe('m2');
  });

  it('UL4: started-but-unpassed modules never move the frontier', () => {
    const f = facts({ m1: { started: true, passed: false }, m2: { started: true } });
    expect(statuses(mods(1, 2, 3), f)).toEqual(['in_progress', 'locked', 'locked']);
  });

  it('UL5: gaps in order are ignored and input order is irrelevant', () => {
    const shuffled: CurriculumModule[] = [
      { id: 'c', order: 9 },
      { id: 'a', order: 1 },
      { id: 'b', order: 5 },
    ];
    const states = deriveModuleStates(shuffled, facts({ a: { passed: true } }));
    expect(states.map((s) => [s.moduleId, s.status, s.position])).toEqual([
      ['a', 'completed', 1],
      ['b', 'unlocked', 2],
      ['c', 'locked', 3],
    ]);
  });

  it('UL5b: equal order values are tie-broken by id', () => {
    const states = deriveModuleStates(
      [
        { id: 'b', order: 1 },
        { id: 'a', order: 1 },
      ],
      new Map(),
    );
    expect(states.map((s) => s.moduleId)).toEqual(['a', 'b']);
  });

  it('UL6: facts for unpublished ids are ignored, and removing a module opens the next', () => {
    // m2 is unpublished: its facts are present but it is not in the curriculum.
    const curriculum: CurriculumModule[] = [
      { id: 'm1', order: 1 },
      { id: 'm3', order: 3 },
    ];
    const f = facts({ m1: { passed: true }, m2: { passed: false, started: true } });
    expect(deriveModuleStates(curriculum, f).map((s) => s.status)).toEqual([
      'completed',
      'unlocked',
    ]);
  });

  it('UL7: an unpassed module moved ahead becomes the frontier and re-locks later ones', () => {
    // m3 (unpassed) now sits at order 1, ahead of the passed m1, m2; m4 was started.
    const curriculum: CurriculumModule[] = [
      { id: 'm3', order: 1 },
      { id: 'm1', order: 2 },
      { id: 'm2', order: 3 },
      { id: 'm4', order: 4 },
    ];
    const f = facts({ m1: { passed: true }, m2: { passed: true }, m4: { started: true } });
    const states = deriveModuleStates(curriculum, f);
    expect(states.map((s) => [s.moduleId, s.status])).toEqual([
      ['m3', 'unlocked'],
      ['m1', 'completed'],
      ['m2', 'completed'],
      ['m4', 'locked'],
    ]);
    expect(states[3]?.lockedBy).toBe('m3');
  });

  it('UL8: a new module inserted first is unlocked and passes stay completed', () => {
    const curriculum: CurriculumModule[] = [
      { id: 'new', order: 0 },
      { id: 'm1', order: 1 },
      { id: 'm2', order: 2 },
    ];
    const states = deriveModuleStates(
      curriculum,
      facts({ m1: { passed: true }, m2: { passed: true } }),
    );
    expect(states.map((s) => s.status)).toEqual(['unlocked', 'completed', 'completed']);
    expect(deriveFinalTestState(states, { passed: false, started: false }).status).toBe('locked');
  });

  it('UL9: an empty curriculum has no modules and a locked final test', () => {
    const states = deriveModuleStates([], new Map());
    expect(states).toEqual([]);
    expect(deriveFinalTestState(states, { passed: false, started: false })).toEqual({
      status: 'locked',
      remainingModules: 0,
    });
  });

  it('UL10: the final test is unlocked, in_progress or completed only after all modules pass', () => {
    const all = deriveModuleStates(
      mods(1, 2),
      facts({ m1: { passed: true }, m2: { passed: true } }),
    );
    expect(deriveFinalTestState(all, { passed: false, started: false })).toEqual({
      status: 'unlocked',
      remainingModules: 0,
    });
    expect(deriveFinalTestState(all, { passed: false, started: true }).status).toBe('in_progress');
    expect(deriveFinalTestState(all, { passed: true, started: true }).status).toBe('completed');

    const some = deriveModuleStates(mods(1, 2), facts({ m1: { passed: true } }));
    expect(deriveFinalTestState(some, { passed: false, started: false })).toEqual({
      status: 'locked',
      remainingModules: 1,
    });
  });

  it('UL11: property over every pass pattern for n <= 8', () => {
    for (let n = 1; n <= 8; n += 1) {
      const curriculum = mods(...Array.from({ length: n }, (_, i) => i + 1));
      for (let mask = 0; mask < 1 << n; mask += 1) {
        for (const startedAll of [false, true]) {
          const f = new Map<string, ModuleFacts>();
          curriculum.forEach((m, i) => {
            f.set(m.id, { started: startedAll, passed: (mask & (1 << i)) !== 0 });
          });
          const states = deriveModuleStates(curriculum, f);
          const open = states.filter((s) => s.status === 'unlocked' || s.status === 'in_progress');
          expect(open.length).toBeLessThanOrEqual(1);
          states.forEach((s, i) => {
            const allEarlierPassed = states.slice(0, i).every((p) => p.status === 'completed');
            const passed = f.get(s.moduleId)?.passed === true;
            expect(isModuleAccessible(s)).toBe(passed || allEarlierPassed);
          });
          const unpassed = states.filter((s) => s.status !== 'completed').length;
          expect(
            deriveFinalTestState(states, { passed: false, started: false }).remainingModules,
          ).toBe(unpassed);
        }
      }
    }
  });
});
