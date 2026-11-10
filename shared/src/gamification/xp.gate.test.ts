import { describe, expect, it } from 'vitest';
import { XP_RULES } from '../constants/gamification.js';
import { computeXp, type GateXpRunFact, type XpFacts } from './xp.js';

const base: XpFacts = { modules: [], finalTest: null };
const run = (
  runId: string,
  closedAt: string,
  over: Partial<GateXpRunFact> = {},
): GateXpRunFact => ({
  runId,
  status: 'passed',
  firstAnswerCorrect: true,
  closedAt,
  ...over,
});
const withRuns = (runs: GateXpRunFact[]): XpFacts => ({ ...base, gate: { runs } });

describe('gate XP', () => {
  it('XPG1: only a passed run whose first answer was correct earns XP', () => {
    const result = computeXp(
      withRuns([
        run('r1', '2026-03-01T08:00:00.000Z', { firstAnswerCorrect: false }),
        run('r2', '2026-03-02T08:00:00.000Z', { status: 'restricted', firstAnswerCorrect: false }),
        run('r3', '2026-03-03T08:00:00.000Z'),
      ]),
    );
    expect(result.total).toBe(XP_RULES.gateDailyCheck);
    expect(result.entries).toEqual([
      {
        key: 'gate:2026-03-03',
        source: 'gate_daily_check',
        amount: 10,
        moduleId: null,
        attemptId: 'r3',
      },
    ]);
  });

  it('XPG2: one entry per organisation-local day, at the zone boundary', () => {
    // 2026-03-01 23:30Z is already 2026-03-02 00:30 in Casablanca (UTC+1 from late March; UTC+0 in
    // early March), so use a zone with a fixed offset on that date.
    const runs = [
      run('a', '2026-07-01T23:30:00.000Z'), // Casablanca (UTC+1): 2026-07-02 00:30
      run('b', '2026-07-02T10:00:00.000Z'), // same local day as a
    ];
    const casa = computeXp(withRuns(runs), { timeZone: 'Africa/Casablanca' });
    expect(casa.entries.map((e) => e.key)).toEqual(['gate:2026-07-02']);
    expect(casa.entries[0]?.attemptId).toBe('a'); // the earliest run of the day owns it
    const utc = computeXp(withRuns(runs));
    expect(utc.entries.map((e) => e.key)).toEqual(['gate:2026-07-01', 'gate:2026-07-02']);

    // New York is UTC-4 in July: 03:30Z on the 2nd is the evening of the 1st.
    const ny = computeXp(
      withRuns([run('c', '2026-07-02T03:30:00.000Z'), run('d', '2026-07-02T15:00:00.000Z')]),
      { timeZone: 'America/New_York' },
    );
    expect(ny.entries.map((e) => e.key)).toEqual(['gate:2026-07-01', 'gate:2026-07-02']);
  });

  it('XPG3: idempotent and order-insensitive, duplicates change nothing', () => {
    const runs = [run('a', '2026-03-01T08:00:00.000Z'), run('b', '2026-03-02T08:00:00.000Z')];
    const once = computeXp(withRuns(runs));
    expect(computeXp(withRuns([...runs, ...runs]))).toEqual(once);
    expect(computeXp(withRuns([...runs].reverse()))).toEqual(once);
    expect(once.total).toBe(20);
  });

  it('XPG4: monotone, an extra run never lowers the total', () => {
    const runs = [run('a', '2026-03-01T08:00:00.000Z')];
    const before = computeXp(withRuns(runs)).total;
    const more = [
      ...runs,
      run('b', '2026-03-01T09:00:00.000Z'),
      run('c', '2026-03-02T09:00:00.000Z', { firstAnswerCorrect: false }),
      run('d', '2026-03-03T09:00:00.000Z', { status: 'restricted', firstAnswerCorrect: false }),
    ];
    expect(computeXp(withRuns(more)).total).toBeGreaterThanOrEqual(before);
  });

  it('XPG5: restricted runs earn nothing, and absent gate facts add nothing', () => {
    expect(
      computeXp(withRuns([run('a', '2026-03-01T08:00:00.000Z', { status: 'restricted' })])).total,
    ).toBe(0);
    expect(computeXp(base).total).toBe(0);
    expect(computeXp({ ...base, gate: undefined }).total).toBe(0);
  });
});
