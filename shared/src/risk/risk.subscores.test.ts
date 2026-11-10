import { describe, expect, it } from 'vitest';
import type { AttemptEndReason } from '../constants/learning.js';
import { behaviouralScore, type ConductAttempt } from './behavioural.js';
import { engagementScore } from './engagement.js';
import { firstAttempts, knowledgeScore } from './knowledge.js';
import { roundHalfUp } from './math.js';
import { simulationScore } from './simulation.js';

const k = (
  attemptNumber: number,
  correctCount: number,
  totalCount: number,
  assessmentId = 'a',
  attemptedAt = `2026-01-01T00:00:0${String(attemptNumber)}.000Z`,
) => ({
  assessmentId,
  attemptedAt,
  attemptNumber,
  correctCount,
  totalCount,
});

const c = (assessmentId: string, endReason: AttemptEndReason, passed: boolean): ConductAttempt => ({
  assessmentId,
  endReason,
  passed,
});

describe('roundHalfUp', () => {
  it('rounds .5 up and validates input', () => {
    expect(roundHalfUp(1, 2)).toBe(1);
    expect(roundHalfUp(1, 3)).toBe(0);
    expect(roundHalfUp(2, 3)).toBe(1);
    expect(roundHalfUp(0, 5)).toBe(0);
    expect(() => roundHalfUp(-1, 2)).toThrow(RangeError);
    expect(() => roundHalfUp(1, 0)).toThrow(RangeError);
    expect(() => roundHalfUp(1.5, 2)).toThrow(RangeError);
  });
});

describe('knowledge', () => {
  it('KN1: perfect is 0, nothing right is 100, mixed is question-weighted', () => {
    expect(knowledgeScore([k(1, 5, 5, 'a'), k(1, 15, 15, 'b')])).toBe(0);
    expect(knowledgeScore([k(1, 0, 5)])).toBe(100);
    expect(knowledgeScore([k(1, 3, 5, 'a'), k(1, 12, 15, 'b')])).toBe(25);
  });

  it('KN2: only the first attempt of each assessment counts', () => {
    expect(knowledgeScore([k(1, 0, 5), k(2, 5, 5), k(3, 5, 5)])).toBe(100);
  });

  it('KN3: an abandoned first attempt (0 of 5 correct) counts as wrong', () => {
    expect(knowledgeScore([k(1, 0, 5)])).toBe(100);
  });

  it('KN4: no first attempt is null', () => {
    expect(knowledgeScore([])).toBeNull();
  });

  it('KN5: the lowest attempt number is the first one, even if 1 is missing; ties use the earliest time', () => {
    expect(knowledgeScore([k(3, 5, 5), k(2, 0, 5)])).toBe(100);
    expect(knowledgeScore([k(2, 5, 5)])).toBe(0);
    expect(
      knowledgeScore([
        k(1, 5, 5, 'a', '2026-02-01T00:00:00.000Z'),
        k(1, 0, 5, 'a', '2026-01-01T00:00:00.000Z'),
      ]),
    ).toBe(100);
    expect(firstAttempts([k(3, 1, 5), k(2, 1, 5), k(5, 1, 5, 'b')])).toHaveLength(2);
  });
});

describe('behavioural (assessment conduct)', () => {
  it('BH1: no attempts is null; four submitted passes score 0', () => {
    expect(behaviouralScore([])).toBeNull();
    expect(behaviouralScore(['a', 'b', 'c', 'd'].map((id) => c(id, 'submitted', true)))).toBe(0);
  });

  it('BH2: two abandoned of four with no extra failures is 25', () => {
    expect(
      behaviouralScore([
        c('a', 'abandoned', false),
        c('b', 'expired', false),
        c('c', 'submitted', true),
        c('d', 'submitted', true),
      ]),
    ).toBe(25);
  });

  it('BH3: four failed submissions at one assessment give 50, and more still give 50 (saturation)', () => {
    const fails = (n: number) => Array.from({ length: n }, () => c('a', 'submitted', false));
    expect(behaviouralScore(fails(4))).toBe(50);
    expect(behaviouralScore(fails(11))).toBe(50);
    // A single failure is forgiven.
    expect(behaviouralScore(fails(1))).toBe(0);
  });

  it('BH4: a non-exact fraction rounds to nearest, and an exact .5 rounds up', () => {
    // n=3, a=1, m=3, R=9: 100 * 9 / (2 * 3 * 9) = 16.67 -> 17
    expect(
      behaviouralScore([
        c('a', 'abandoned', false),
        c('b', 'submitted', true),
        c('c', 'submitted', true),
      ]),
    ).toBe(17);
    // n=4, a=1, m=2, R=6: 100 * 6 / (2 * 4 * 6) = 12.5 exactly -> 13
    expect(
      behaviouralScore([
        c('a', 'abandoned', false),
        c('a', 'submitted', true),
        c('b', 'submitted', true),
        c('b', 'submitted', true),
      ]),
    ).toBe(13);
  });
});

describe('behavioural cooldowns', () => {
  it('BH5: each cooldown adds 25 points, at most two count, and the score caps at 100', () => {
    const passes = ['a', 'b', 'c', 'd'].map((id) => c(id, 'submitted', true));
    expect(behaviouralScore(passes, 0)).toBe(0);
    expect(behaviouralScore(passes, 1)).toBe(25);
    expect(behaviouralScore(passes, 2)).toBe(50);
    expect(behaviouralScore(passes, 9)).toBe(50);
    expect(behaviouralScore([], 3)).toBeNull();
    const fails = Array.from({ length: 30 }, () => c('a', 'abandoned', false));
    expect(behaviouralScore(fails, 2)).toBe(100);
  });
});

describe('simulation', () => {
  it('SM1: no outcomes is null', () => {
    expect(simulationScore([])).toBeNull();
  });

  it('SM2: the points table, and only the last five by time count', () => {
    const at = (n: number) => `2026-01-0${String(n)}T00:00:00.000Z`;
    expect(simulationScore([{ outcome: 'reported', occurredAt: at(1) }])).toBe(0);
    expect(simulationScore([{ outcome: 'no_action', occurredAt: at(1) }])).toBe(25);
    expect(simulationScore([{ outcome: 'clicked_then_reported', occurredAt: at(1) }])).toBe(50);
    expect(simulationScore([{ outcome: 'clicked', occurredAt: at(1) }])).toBe(75);
    const sixth = [
      { outcome: 'credentials_submitted' as const, occurredAt: at(1) }, // oldest, dropped
      ...[2, 3, 4, 5, 6].map((n) => ({ outcome: 'reported' as const, occurredAt: at(n) })),
    ];
    expect(simulationScore(sixth)).toBe(0);
    expect(simulationScore([...sixth].reverse())).toBe(0);
  });

  it('SM3: credentials submitted alone is 100', () => {
    expect(
      simulationScore([
        { outcome: 'credentials_submitted', occurredAt: '2026-01-01T00:00:00.000Z' },
      ]),
    ).toBe(100);
  });
});

describe('engagement', () => {
  const ids = ['1', '2', '3', '4', '5', '6', '7'];

  it('EN1: nothing passed is 100, 7 of 7 modules without the final is 13, all is 0', () => {
    expect(
      engagementScore({
        moduleIds: ids,
        passedModuleIds: [],
        finalTestExists: true,
        finalTestPassed: false,
      }),
    ).toBe(100);
    expect(
      engagementScore({
        moduleIds: ids,
        passedModuleIds: ids,
        finalTestExists: true,
        finalTestPassed: false,
      }),
    ).toBe(13);
    expect(
      engagementScore({
        moduleIds: ids,
        passedModuleIds: ids,
        finalTestExists: true,
        finalTestPassed: true,
      }),
    ).toBe(0);
  });

  it('EN2: no curriculum and no final test is null', () => {
    expect(
      engagementScore({
        moduleIds: [],
        passedModuleIds: [],
        finalTestExists: false,
        finalTestPassed: false,
      }),
    ).toBeNull();
  });

  it('EN3: passes on unpublished modules are ignored; a final pass without a final test is ignored', () => {
    expect(
      engagementScore({
        moduleIds: ['1', '2'],
        passedModuleIds: ['9', '1'],
        finalTestExists: false,
        finalTestPassed: true,
      }),
    ).toBe(50);
  });
});
