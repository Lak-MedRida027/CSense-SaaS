import { describe, expect, it } from 'vitest';
import { BEHAVIOURAL_GROUP_WEIGHTS, RISK_MODEL_VERSION } from '../constants/risk.js';
import { behaviouralScore, behaviouralScoreV2, type ConductAttempt } from './behavioural.js';
import { gateScore, recentGateRuns, type GateRunFact } from './gate.js';
import { computeRiskProfile, type RiskFacts } from './profile.js';

let n = 0;
const run = (
  status: GateRunFact['status'],
  firstAnswerCorrect: boolean,
  closedAt?: string,
): GateRunFact => {
  n += 1;
  return {
    status,
    firstAnswerCorrect,
    closedAt: closedAt ?? new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
  };
};
const pass = (first = true): GateRunFact => run('passed', first);
/** A run that ended restricted (the first answer of such a run is normally wrong). */
const restricted = (firstAnswerCorrect = false): GateRunFact =>
  run('restricted', firstAnswerCorrect);

describe('gateScore', () => {
  it('GR1: no closed runs is null', () => {
    expect(gateScore([])).toBeNull();
  });

  it('GR2: single runs', () => {
    expect(gateScore([pass(true)])).toBe(0);
    expect(gateScore([pass(false)])).toBe(100);
    expect(gateScore([restricted()])).toBe(100);
  });

  it('GR3: only the last 20 runs by closedAt count, whatever the input order', () => {
    const old = Array.from({ length: 5 }, () => restricted()); // oldest, outside the window
    const recent = Array.from({ length: 20 }, () => pass(true));
    expect(gateScore([...old, ...recent])).toBe(0);
    expect(gateScore([...old, ...recent].reverse())).toBe(0);
    expect(recentGateRuns([...old, ...recent])).toHaveLength(20);
  });

  it('GR4: the restriction bonus counts at most two restricted runs', () => {
    const passes = (count: number): GateRunFact[] =>
      Array.from({ length: count }, () => pass(true));
    // 1 restricted (first answer right, for isolation): 0 wrong + 35
    expect(gateScore([...passes(19), restricted(true)])).toBe(35);
    // 2 restricted: 70
    expect(gateScore([...passes(18), restricted(true), restricted(true)])).toBe(70);
    // 3 restricted: still 70 from the bonus; the wrong-first share adds 3 of 20 = 15
    expect(gateScore([...passes(17), restricted(), restricted(), restricted()])).toBe(15 + 70);
  });

  it('GR5: the score is capped at 100', () => {
    expect(gateScore([restricted(), restricted(), restricted()])).toBe(100);
  });

  it('GR6: half-up rounding of the wrong-first share', () => {
    // 1 of 8 = 12.5 -> 13
    expect(gateScore([pass(false), ...Array.from({ length: 7 }, () => pass(true))])).toBe(13);
    // 1 of 3 = 33.33 -> 33 ; 2 of 3 = 66.67 -> 67
    expect(gateScore([pass(false), pass(true), pass(true)])).toBe(33);
    expect(gateScore([pass(false), pass(false), pass(true)])).toBe(67);
  });

  it('GR7: identical timestamps are ordered deterministically', () => {
    const at = '2026-02-01T00:00:00.000Z';
    const a = run('passed', true, at);
    const b = run('restricted', false, at);
    expect(recentGateRuns([a, b])).toEqual(recentGateRuns([b, a]));
  });
});

const submitted = (assessmentId: string, passed: boolean): ConductAttempt => ({
  assessmentId,
  endReason: 'submitted',
  passed,
});
const abandoned = (assessmentId: string): ConductAttempt => ({
  assessmentId,
  endReason: 'abandoned',
  passed: false,
});

/** The plan's reference gate: 20 runs, 2 wrong first answers, 1 restricted = 10 + 35 = 45. */
const gate45 = (): GateRunFact[] => [
  ...Array.from({ length: 17 }, () => pass(true)),
  pass(false),
  pass(false),
  restricted(true),
];

describe('behaviouralScoreV2', () => {
  it('BV1: the reference gate score is 45', () => {
    expect(gateScore(gate45())).toBe(45);
  });

  it('BV2: blends 70 gate / 30 conduct and rounds half up (45 and 20 give 37.5 -> 38)', () => {
    // 4 abandoned of 10 attempts over 10 assessments: conduct = round(100 * 4 * 30 / (2 * 10 * 30)) = 20
    const attempts: ConductAttempt[] = [
      ...['a', 'b', 'c', 'd'].map(abandoned),
      ...['e', 'f', 'g', 'h', 'i', 'j'].map((id) => submitted(id, true)),
    ];
    expect(behaviouralScore(attempts, 0)).toBe(20);
    expect((70 * 45 + 30 * 20) / 100).toBe(37.5);
    expect(behaviouralScoreV2(attempts, 0, gate45())).toBe(38);
  });

  it('BV3: either side alone is used as is', () => {
    const attempts = [abandoned('a'), submitted('a', true)];
    expect(behaviouralScoreV2(attempts, 0, [])).toBe(behaviouralScore(attempts, 0));
    expect(behaviouralScoreV2([], 0, [restricted()])).toBe(100);
    expect(behaviouralScoreV2([], 0, [pass(true)])).toBe(0);
  });

  it('BV4: neither side is not assessed (null)', () => {
    expect(behaviouralScoreV2([], 0, [])).toBeNull();
  });

  it('BV5: the model version and the weights are pinned', () => {
    expect(RISK_MODEL_VERSION).toBe(2);
    expect(BEHAVIOURAL_GROUP_WEIGHTS).toEqual({ gate: 70, conduct: 30 });
  });

  it('BV6: the profile reads the gate runs and does not depend on their order', () => {
    const base: RiskFacts = {
      attempts: [],
      curriculum: {
        moduleIds: ['m1'],
        passedModuleIds: [],
        finalTestExists: false,
        finalTestPassed: false,
      },
      cooldowns: [],
      simulation: { enabled: false, outcomes: [] },
      gate: null,
    };
    expect(computeRiskProfile(base).scores.behavioural).toBeNull();
    const runs = [pass(false), restricted(), pass(true)];
    const a = computeRiskProfile({ ...base, gate: { runs } });
    const b = computeRiskProfile({ ...base, gate: { runs: [...runs].reverse() } });
    expect(a.scores.behavioural).not.toBeNull();
    expect(a.scores.behavioural).toBe(b.scores.behavioural);
    expect(a.modelVersion).toBe(2);
  });
});
