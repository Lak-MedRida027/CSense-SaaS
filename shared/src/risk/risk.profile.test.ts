import { describe, expect, it } from 'vitest';
import { RISK_MODEL_VERSION } from '../constants/risk.js';
import { decideRiskTransition } from './transitions.js';
import { computeRiskProfile, type RiskAttemptFact, type RiskFacts } from './profile.js';

const attempt = (
  assessmentId: string,
  attemptNumber: number,
  correct: number,
  total = 5,
  overrides: Partial<RiskAttemptFact> = {},
): RiskAttemptFact => ({
  assessmentId,
  kind: 'Quiz',
  attemptNumber,
  attemptedAt: `2026-01-01T00:00:${String(10 + attemptNumber)}.000Z`,
  endReason: 'submitted',
  passed: correct / total >= 0.7,
  correctCount: correct,
  totalCount: total,
  ...overrides,
});

const facts = (
  attempts: RiskAttemptFact[],
  over: Partial<RiskFacts['curriculum']> = {},
): RiskFacts => ({
  attempts,
  curriculum: {
    moduleIds: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'],
    passedModuleIds: [],
    finalTestExists: true,
    finalTestPassed: false,
    ...over,
  },
  cooldowns: [],
  simulation: { enabled: false, outcomes: [] },
  gate: null,
});

describe('computeRiskProfile', () => {
  it('RP1: not assessed with one first attempt, assessed with two; assessed with one when N = 1', () => {
    const one = computeRiskProfile(facts([attempt('q1', 1, 5)]));
    expect(one.assessed).toBe(false);
    expect(one.compositeScore).toBeNull();
    expect(one.riskLevel).toBeNull();
    expect(one.scores.knowledge).toBe(0); // sub-scores are still reported

    const two = computeRiskProfile(facts([attempt('q1', 1, 5), attempt('q2', 1, 5)]));
    expect(two.assessed).toBe(true);
    expect(two.riskLevel).not.toBeNull();

    const single = computeRiskProfile(
      facts([attempt('q1', 1, 5)], { moduleIds: ['m1'], finalTestExists: false }),
    );
    expect(single.assessed).toBe(true);

    // A retry of the same assessment is not a second first attempt.
    const sameTwice = computeRiskProfile(facts([attempt('q1', 1, 5), attempt('q1', 2, 5)]));
    expect(sameTwice.assessed).toBe(false);

    const none = computeRiskProfile(facts([]));
    expect(none.assessed).toBe(false);
    expect(none.scores.knowledge).toBeNull();
  });

  it('RP2: the crafted case K 100, B 25, S disabled, E 88 is 71 and High', () => {
    // Module 1: abandoned first session, a failed 1/5, then a 4/5 pass. Module 2: abandoned first.
    const result = computeRiskProfile(
      facts(
        [
          attempt('q1', 1, 0, 5, { endReason: 'abandoned', passed: false }),
          attempt('q1', 2, 1, 5, { passed: false }),
          attempt('q1', 3, 4, 5, { passed: true }),
          attempt('q2', 1, 0, 5, { endReason: 'abandoned', passed: false }),
        ],
        { passedModuleIds: ['m1'] },
      ),
    );
    expect(result.scores).toStrictEqual({
      knowledge: 100,
      behavioural: 25,
      simulation: null,
      engagement: 88,
    });
    expect(result.coverage.simulation).toBe('disabled');
    expect(result.compositeScore).toBe(71);
    expect(result.riskLevel).toBe('High');
  });

  it('RP3: the result does not depend on the order of the attempts', () => {
    const list = [
      attempt('q1', 1, 3),
      attempt('q1', 2, 5),
      attempt('q2', 1, 0, 5, { endReason: 'abandoned', passed: false }),
      attempt('q3', 1, 4),
    ];
    const forward = computeRiskProfile(facts(list));
    const reversed = computeRiskProfile(facts([...list].reverse()));
    expect(reversed).toStrictEqual(forward);
  });

  it('RP4: modelVersion is 1 and the evidence counts are exact', () => {
    const result = computeRiskProfile(
      facts(
        [
          attempt('q1', 1, 0, 5, { endReason: 'abandoned', passed: false }),
          attempt('q1', 2, 1, 5, { passed: false }),
          attempt('q1', 3, 1, 5, { passed: false }),
          attempt('q2', 1, 0, 5, { endReason: 'expired', passed: false }),
          attempt('q3', 1, 5),
        ],
        { passedModuleIds: ['m3', 'zzz'] },
      ),
    );
    expect(result.modelVersion).toBe(RISK_MODEL_VERSION);
    expect(result.modelVersion).toBe(1);
    expect(result.evidence).toStrictEqual({
      attempts: 5,
      firstAttempts: 3,
      abandoned: 1,
      expired: 1,
      extraFailures: 1,
      cooldowns: 0,
      passedModules: 1,
      curriculumSize: 8,
      finalTestPassed: false,
      simulationOutcomes: 0,
    });
  });

  it('RP5: scores are integers 0..100 or null for random facts', () => {
    let seed = 42;
    const rand = (n: number): number => {
      seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
      return seed % n;
    };
    const reasons = ['submitted', 'abandoned', 'expired'] as const;
    for (let i = 0; i < 500; i += 1) {
      const list: RiskAttemptFact[] = [];
      for (let j = 0; j < rand(12); j += 1) {
        const reason = reasons[rand(3)] ?? 'submitted';
        const total = 1 + rand(15);
        list.push(
          attempt(
            `q${String(rand(5))}`,
            1 + rand(4),
            reason === 'submitted' ? rand(total + 1) : 0,
            total,
            {
              endReason: reason,
              passed: reason === 'submitted' && rand(2) === 0,
            },
          ),
        );
      }
      const r = computeRiskProfile({
        ...facts(list, { passedModuleIds: ['m1'].slice(0, rand(2)) }),
        simulation: {
          enabled: rand(2) === 0,
          outcomes: [{ outcome: 'clicked' as const, occurredAt: '2026-01-01T00:00:00.000Z' }].slice(
            0,
            rand(2),
          ),
        },
      });
      for (const s of [...Object.values(r.scores), r.compositeScore]) {
        if (s === null) continue;
        expect(Number.isInteger(s)).toBe(true);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(100);
      }
    }
  });

  it('cooldowns raise Behavioural and are counted in the evidence', () => {
    const base = facts([attempt('q1', 1, 5), attempt('q2', 1, 5)]);
    const hot = computeRiskProfile({
      ...base,
      cooldowns: [
        { assessmentId: 'q1', at: '2026-01-02T00:00:00.000Z' },
        { assessmentId: 'q1', at: '2026-01-03T00:00:00.000Z' },
      ],
    });
    expect(computeRiskProfile(base).scores.behavioural).toBe(0);
    expect(hot.scores.behavioural).toBe(50);
    expect(hot.evidence.cooldowns).toBe(2);
  });

  it('simulation is assessed when enabled with outcomes and not_assessed without', () => {
    const base = facts([attempt('q1', 1, 5), attempt('q2', 1, 5)]);
    expect(computeRiskProfile(base).coverage.simulation).toBe('disabled');
    const on = computeRiskProfile({ ...base, simulation: { enabled: true, outcomes: [] } });
    expect(on.coverage.simulation).toBe('not_assessed');
    const withOutcome = computeRiskProfile({
      ...base,
      simulation: {
        enabled: true,
        outcomes: [{ outcome: 'credentials_submitted', occurredAt: '2026-01-01T00:00:00.000Z' }],
      },
    });
    expect(withOutcome.coverage.simulation).toBe('assessed');
    expect(withOutcome.scores.simulation).toBe(100);
  });
});

describe('decideRiskTransition', () => {
  const levels = [null, 'Low', 'Medium', 'High'] as const;
  const rank = (l: (typeof levels)[number]): number => levels.indexOf(l);

  it('RT1: the full 4x4 table', () => {
    for (const prev of levels) {
      for (const next of levels) {
        const t = decideRiskTransition(prev, next);
        expect(t.levelChanged, `${String(prev)}->${String(next)}`).toBe(prev !== next);
        expect(t.escalate, `${String(prev)}->${String(next)}`).toBe(
          next === 'High' && prev !== 'High',
        );
        const direction = prev === next ? 'none' : rank(next) > rank(prev) ? 'up' : 'down';
        expect(t.direction).toBe(direction);
        expect(t.auditSeverity).toBe(direction === 'up' && next !== 'Low' ? 'warning' : 'info');
      }
    }
  });
});
