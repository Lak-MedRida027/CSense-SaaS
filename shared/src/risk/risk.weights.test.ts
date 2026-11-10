import { describe, expect, it } from 'vitest';
import {
  RISK_DIMENSIONS,
  RISK_WEIGHTS,
  RISK_WEIGHTS_BP,
  RISK_WEIGHTS_BP_TOTAL,
  type DimensionCoverage,
  type RiskDimension,
} from '../constants/risk.js';
import {
  computeComposite,
  effectiveWeights,
  type DimensionCoverageMap,
  type DimensionScores,
} from './composite.js';

const allAssessed: DimensionCoverageMap = {
  knowledge: 'assessed',
  behavioural: 'assessed',
  simulation: 'assessed',
  engagement: 'assessed',
};

const scoresOf = (k: number | null, b: number | null, s: number | null, e: number | null) =>
  ({ knowledge: k, behavioural: b, simulation: s, engagement: e }) satisfies DimensionScores;

describe('risk weights (CLAUDE.md: Knowledge 30 / Behavioural 25 / Simulation 30 / Engagement 15)', () => {
  it('RW1: RISK_WEIGHTS is exactly 0.3 / 0.25 / 0.3 / 0.15 and frozen', () => {
    expect(RISK_WEIGHTS).toStrictEqual({
      knowledge: 0.3,
      behavioural: 0.25,
      simulation: 0.3,
      engagement: 0.15,
    });
    expect(Object.isFrozen(RISK_WEIGHTS)).toBe(true);
    expect(Object.isFrozen(RISK_WEIGHTS_BP)).toBe(true);
    expect(RISK_DIMENSIONS).toStrictEqual(['knowledge', 'behavioural', 'simulation', 'engagement']);
  });

  it('RW2: the basis-point weights are 3000 / 2500 / 3000 / 1500, sum to 10000 and equal weight x 10000', () => {
    expect(RISK_WEIGHTS_BP).toStrictEqual({
      knowledge: 3000,
      behavioural: 2500,
      simulation: 3000,
      engagement: 1500,
    });
    expect(Object.values(RISK_WEIGHTS_BP).reduce((a, b) => a + b, 0)).toBe(RISK_WEIGHTS_BP_TOTAL);
    for (const d of RISK_DIMENSIONS) {
      expect(Math.round(RISK_WEIGHTS[d] * 10_000)).toBe(RISK_WEIGHTS_BP[d]);
    }
  });

  it('RW3: one dimension at 100 and the others at 0 yields exactly 30 / 25 / 30 / 15', () => {
    const expected: Record<RiskDimension, number> = {
      knowledge: 30,
      behavioural: 25,
      simulation: 30,
      engagement: 15,
    };
    for (const d of RISK_DIMENSIONS) {
      const scores = scoresOf(0, 0, 0, 0);
      scores[d] = 100;
      expect(computeComposite(scores, allAssessed), d).toBe(expected[d]);
    }
  });

  it('RW4: all four dimensions equal to x give x, for every x in 0..100', () => {
    for (let x = 0; x <= 100; x += 1) {
      expect(computeComposite(scoresOf(x, x, x, x), allAssessed)).toBe(x);
    }
  });

  it('RW5: with Simulation disabled the nominal weights are re-normalised', () => {
    const coverage: DimensionCoverageMap = { ...allAssessed, simulation: 'disabled' };
    expect(computeComposite(scoresOf(100, 0, null, 0), coverage)).toBe(43);
    expect(computeComposite(scoresOf(0, 100, null, 0), coverage)).toBe(36);
    expect(computeComposite(scoresOf(0, 0, null, 100), coverage)).toBe(21);
    expect(effectiveWeights(scoresOf(100, 0, null, 0), coverage)).toStrictEqual({
      knowledge: 4286,
      behavioural: 3571,
      simulation: 0,
      engagement: 2143,
    });
  });

  it('effective weights always sum to 10000 for every coverage combination', () => {
    const states: DimensionCoverage[] = ['assessed', 'not_assessed', 'disabled'];
    for (const k of states)
      for (const b of states)
        for (const s of states)
          for (const e of states) {
            const coverage: DimensionCoverageMap = {
              knowledge: k,
              behavioural: b,
              simulation: s,
              engagement: e,
            };
            const scores = scoresOf(
              k === 'assessed' ? 10 : null,
              b === 'assessed' ? 20 : null,
              s === 'assessed' ? 30 : null,
              e === 'assessed' ? 40 : null,
            );
            const sum = Object.values(effectiveWeights(scores, coverage)).reduce(
              (x, y) => x + y,
              0,
            );
            const any = [k, b, s, e].includes('assessed');
            expect(sum).toBe(any ? 10_000 : 0);
            expect(computeComposite(scores, coverage) === null).toBe(!any);
          }
  });

  it('RW6: raising any assessed sub-score never lowers the composite (seeded random cases)', () => {
    let seed = 123_456_789;
    const rand = (): number => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed / 4_294_967_296;
    };
    const states: DimensionCoverage[] = ['assessed', 'not_assessed', 'disabled'];
    for (let i = 0; i < 10_000; i += 1) {
      const coverage = {} as Record<RiskDimension, DimensionCoverage>;
      const scores = scoresOf(0, 0, 0, 0);
      for (const d of RISK_DIMENSIONS) {
        coverage[d] =
          rand() < 0.7 ? 'assessed' : (states[1 + Math.floor(rand() * 2)] ?? 'disabled');
        scores[d] = coverage[d] === 'assessed' ? Math.floor(rand() * 101) : null;
      }
      const dim = RISK_DIMENSIONS[Math.floor(rand() * 4)] as RiskDimension;
      const before = computeComposite(scores, coverage);
      const current = scores[dim];
      if (current === null) continue;
      const raised = { ...scores, [dim]: Math.min(100, current + 1 + Math.floor(rand() * 20)) };
      const after = computeComposite(raised, coverage);
      expect(after ?? -1).toBeGreaterThanOrEqual(before ?? -1);
    }
  });
});
