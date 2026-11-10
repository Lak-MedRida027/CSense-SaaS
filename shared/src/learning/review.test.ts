import { describe, expect, it } from 'vitest';
import { revealPolicy } from './review.js';

describe('revealPolicy', () => {
  it('RV1: a failed submitted attempt on an unpassed assessment hides the correct option', () => {
    expect(revealPolicy({ endReason: 'submitted', passed: false }, false)).toEqual({
      showCorrectness: true,
      showExplanation: true,
      showCorrectOption: false,
    });
  });

  it('RV2: a passing attempt shows everything', () => {
    expect(revealPolicy({ endReason: 'submitted', passed: true }, true)).toEqual({
      showCorrectness: true,
      showExplanation: true,
      showCorrectOption: true,
    });
  });

  it('RV3: a failed attempt viewed after a later pass shows the correct option', () => {
    expect(revealPolicy({ endReason: 'submitted', passed: false }, true).showCorrectOption).toBe(
      true,
    );
  });

  it('RV4: abandoned and expired attempts reveal nothing', () => {
    for (const endReason of ['abandoned', 'expired'] as const) {
      for (const assessmentPassed of [false, true]) {
        expect(revealPolicy({ endReason, passed: false }, assessmentPassed)).toEqual({
          showCorrectness: false,
          showExplanation: false,
          showCorrectOption: false,
        });
      }
    }
  });
});
