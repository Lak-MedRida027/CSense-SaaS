import { describe, expect, it } from 'vitest';
import { LEVELS } from './levels.js';
import { RISK_LEVELS, RISK_LEVEL_TO_STATE, RISK_WEIGHTS } from './risk.js';

describe('risk constants', () => {
  it('uses the fixed weights from CLAUDE.md', () => {
    expect(RISK_WEIGHTS).toEqual({
      knowledge: 0.3,
      behavioural: 0.25,
      simulation: 0.3,
      engagement: 0.15,
    });
  });

  it('weights sum to 1', () => {
    const sum = Object.values(RISK_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('weights cannot be mutated at runtime', () => {
    expect(Object.isFrozen(RISK_WEIGHTS)).toBe(true);
  });

  it('maps Low/Medium/High to Green/Amber/Red', () => {
    expect(RISK_LEVELS).toEqual(['Low', 'Medium', 'High']);
    expect(RISK_LEVEL_TO_STATE).toEqual({ Low: 'Green', Medium: 'Amber', High: 'Red' });
  });
});

describe('levels', () => {
  it('lists the five tiers in order', () => {
    expect(LEVELS).toEqual(['Apprentice', 'Aware', 'Practitioner', 'Guardian', 'Defender']);
  });
});
