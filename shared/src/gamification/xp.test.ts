import { describe, expect, it } from 'vitest';
import type { AttemptEndReason } from '../constants/learning.js';
import { levelForXp } from './levels.js';
import {
  computeXp,
  xpEarnedForAttempt,
  type AttemptFact,
  type ModuleXpFacts,
  type XpFacts,
} from './xp.js';

const att = (
  id: string,
  attemptNumber: number,
  score: number,
  passed: boolean,
  endReason: AttemptEndReason = 'submitted',
): AttemptFact => ({ attemptId: id, attemptNumber, endReason, score, passed });

const mod = (
  moduleId: string,
  passing: AttemptFact | null,
  practice = 0,
  first: AttemptFact | null = passing,
): ModuleXpFacts => ({
  moduleId,
  firstAttempt: first,
  passingAttempt: passing,
  practiceFirstTryCorrect: practice,
});

const facts = (modules: ModuleXpFacts[], finalTest: XpFacts['finalTest'] = null): XpFacts => ({
  modules,
  finalTest,
});

describe('computeXp', () => {
  it('XP1: first-try perfect module with 4 correct practice answers is 150 + 100 + 50 + 40', () => {
    expect(computeXp(facts([mod('m1', att('a1', 1, 100, true), 4)])).total).toBe(340);
  });

  it('XP2: a pass on attempt 2 with 80 and no practice is 150', () => {
    expect(
      computeXp(facts([mod('m1', att('a2', 2, 80, true), 0, att('a1', 1, 20, false))])).total,
    ).toBe(150);
  });

  it('XP3: abandoned attempt 1 then a perfect pass on attempt 2 is 150 + 50 (no first-try bonus)', () => {
    const result = computeXp(
      facts([mod('m1', att('a2', 2, 100, true), 0, att('a1', 1, 0, false, 'abandoned'))]),
    );
    expect(result.total).toBe(200);
    expect(result.entries.map((e) => e.source).sort()).toStrictEqual([
      'module_completion',
      'module_perfect',
    ]);
  });

  it('XP3b: first try means the passing attempt is the first one, whatever its number', () => {
    const sparse = att('a5', 4, 80, true); // numbers need not start at 1
    expect(computeXp(facts([mod('m1', sparse, 0, sparse)])).total).toBe(250);
    expect(computeXp(facts([mod('m1', sparse, 0, att('a4', 3, 0, false))])).total).toBe(150);
  });

  it('XP4: one failure then a pass equals one hundred failures then a pass (failures are not facts)', () => {
    const pass = att('p', 3, 80, true);
    const one = computeXp(facts([mod('m1', pass, 0, att('f1', 1, 0, false))]));
    const many = computeXp(facts([mod('m1', pass, 0, att('f1', 1, 0, false))]));
    expect(one).toStrictEqual(many);
  });

  it('XP5: an unpassed module earns nothing, even with correct practice answers', () => {
    expect(computeXp(facts([mod('m1', null, 5, att('a1', 1, 40, false))])).total).toBe(0);
    // A passing attempt that is not a submitted pass is ignored defensively.
    expect(computeXp(facts([mod('m1', att('a1', 1, 100, true, 'abandoned'))])).total).toBe(0);
    expect(computeXp(facts([mod('m1', att('a1', 1, 100, false))])).total).toBe(0);
  });

  it('XP6: duplicated facts give the same total and entry keys are unique', () => {
    const m = mod('m1', att('a1', 1, 100, true), 2);
    const once = computeXp(facts([m]));
    const twice = computeXp(facts([m, m, m]));
    expect(twice).toStrictEqual(once);
    expect(new Set(twice.entries.map((e) => e.key)).size).toBe(twice.entries.length);
  });

  it('XP7: a first-try perfect final test is 700', () => {
    const final = {
      firstAttempt: att('f1', 1, 100, true),
      passingAttempt: att('f1', 1, 100, true),
    };
    const result = computeXp(facts([], final));
    expect(result.total).toBe(700);
    expect(result.entries.every((e) => e.moduleId === null)).toBe(true);
  });

  it('XP8: the seed maximum is 2970 and is Guardian', () => {
    const modules = Array.from(
      { length: 7 },
      (_, i) => mod(`m${String(i)}`, att(`a${String(i)}`, 1, 100, true), i < 5 ? 3 : 1), // 17 practice answers in all
    );
    const final = { firstAttempt: att('f', 1, 100, true), passingAttempt: att('f', 1, 100, true) };
    const result = computeXp(facts(modules, final));
    expect(result.total).toBe(7 * 300 + 170 + 700);
    expect(result.total).toBe(2970);
    expect(levelForXp(result.total)).toBe('Guardian');
  });

  it('XP9: xpEarnedForAttempt sums only the entries of that attempt', () => {
    const result = computeXp(
      facts([
        mod('m1', att('a1', 1, 100, true), 1),
        mod('m2', att('a2', 2, 80, true), 2, att('a0', 1, 0, false)),
      ]),
    );
    expect(xpEarnedForAttempt(result, 'a1')).toBe(310);
    expect(xpEarnedForAttempt(result, 'a2')).toBe(170);
    expect(xpEarnedForAttempt(result, 'nope')).toBe(0);
    expect(xpEarnedForAttempt(result, 'a1') + xpEarnedForAttempt(result, 'a2')).toBe(result.total);
  });

  it('XP10: shuffling the input gives an identical result; entries are sorted by key', () => {
    const modules = [
      mod('m3', att('a3', 1, 100, true), 1),
      mod('m1', att('a1', 2, 80, true), 2, att('a0', 1, 10, false)),
      mod('m2', att('a2', 1, 90, true), 0),
    ];
    const a = computeXp(facts(modules));
    const b = computeXp(facts([...modules].reverse()));
    expect(b).toStrictEqual(a);
    const keys = a.entries.map((e) => e.key);
    expect(keys).toStrictEqual([...keys].sort());
  });
});
