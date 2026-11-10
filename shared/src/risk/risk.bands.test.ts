import { describe, expect, it } from 'vitest';
import { RISK_BANDS, RISK_LEVEL_TO_STATE } from '../constants/risk.js';
import { classifyRisk, riskStateFor } from './classify.js';
import { computeComposite, type DimensionCoverageMap } from './composite.js';

const all: DimensionCoverageMap = {
  knowledge: 'assessed',
  behavioural: 'assessed',
  simulation: 'assessed',
  engagement: 'assessed',
};

describe('risk bands', () => {
  it('RB1: 0 and 39 are Low, 40 and 69 Medium, 70 and 100 High', () => {
    expect([0, 39].map(classifyRisk)).toStrictEqual(['Low', 'Low']);
    expect([40, 69].map(classifyRisk)).toStrictEqual(['Medium', 'Medium']);
    expect([70, 100].map(classifyRisk)).toStrictEqual(['High', 'High']);
  });

  it('RB2: invalid composites throw', () => {
    for (const bad of [-1, 101, 39.5, Number.NaN, '40' as unknown as number]) {
      expect(() => classifyRisk(bad)).toThrow(RangeError);
    }
  });

  it('RB3: every integer 0..100 is in exactly one band; the bands are contiguous', () => {
    for (let n = 0; n <= 100; n += 1) {
      expect(RISK_BANDS.filter((b) => n >= b.min && n <= b.max)).toHaveLength(1);
    }
    expect(RISK_BANDS[0]?.min).toBe(0);
    expect(RISK_BANDS.at(-1)?.max).toBe(100);
    for (let i = 1; i < RISK_BANDS.length; i += 1) {
      expect((RISK_BANDS[i]?.min ?? 0) - (RISK_BANDS[i - 1]?.max ?? 0)).toBe(1);
    }
  });

  it('RB4: the half-up boundary cases from the plan', () => {
    // K, B, S, E -> composite -> level
    expect(
      computeComposite({ knowledge: 100, behavioural: 0, simulation: 0, engagement: 63 }, all),
    ).toBe(39);
    expect(
      computeComposite({ knowledge: 100, behavioural: 38, simulation: 0, engagement: 0 }, all),
    ).toBe(40);
    expect(
      computeComposite({ knowledge: 100, behavioural: 38, simulation: 100, engagement: 0 }, all),
    ).toBe(70);
    expect(
      computeComposite({ knowledge: 100, behavioural: 0, simulation: 100, engagement: 63 }, all),
    ).toBe(69);
    const disabled: DimensionCoverageMap = { ...all, simulation: 'disabled' };
    expect(
      computeComposite(
        { knowledge: 100, behavioural: 0, simulation: null, engagement: 0 },
        disabled,
      ),
    ).toBe(43);
    const crafted = computeComposite(
      { knowledge: 100, behavioural: 25, simulation: null, engagement: 88 },
      disabled,
    );
    expect(crafted).toBe(71);
    expect(classifyRisk(crafted ?? -1)).toBe('High');
    expect(classifyRisk(39)).toBe('Low');
    expect(classifyRisk(40)).toBe('Medium');
    expect(classifyRisk(70)).toBe('High');
    expect(classifyRisk(69)).toBe('Medium');
  });

  it('RB5: levels map to Green / Amber / Red and riskStateFor agrees', () => {
    expect(RISK_LEVEL_TO_STATE).toStrictEqual({ Low: 'Green', Medium: 'Amber', High: 'Red' });
    expect(riskStateFor('Low')).toBe('Green');
    expect(riskStateFor('Medium')).toBe('Amber');
    expect(riskStateFor('High')).toBe('Red');
  });

  it('RB6: the UI fixture composites 72 / 55 / 44 / 28 classify High / Medium / Medium / Low', () => {
    expect([72, 55, 44, 28].map(classifyRisk)).toStrictEqual(['High', 'Medium', 'Medium', 'Low']);
  });
});
