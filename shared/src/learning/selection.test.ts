import { describe, expect, it } from 'vitest';
import { selectQuestionIds, type ShuffleFn } from './selection.js';

const pool = Array.from({ length: 10 }, (_, i) => `q${String(i)}`);
const identity: ShuffleFn = (items) => [...items];
const reverse: ShuffleFn = (items) => [...items].reverse();

describe('selectQuestionIds', () => {
  it('SEL1: serves the requested number of distinct questions from the pool', () => {
    const chosen = selectQuestionIds(pool, [], 5, identity);
    expect(chosen).toHaveLength(5);
    expect(new Set(chosen).size).toBe(5);
    expect(chosen.every((id) => pool.includes(id))).toBe(true);
  });

  it('SEL2: prefers questions that were never served', () => {
    const chosen = selectQuestionIds(pool, [['q0', 'q1', 'q2', 'q3', 'q4']], 5, identity);
    expect([...chosen].sort()).toEqual(['q5', 'q6', 'q7', 'q8', 'q9']);
  });

  it('SEL3: tops up from unseen first, then from the least recently served', () => {
    // Attempt 0 served q0-q3, attempt 1 served q4-q7: only q8, q9 are unseen.
    const history = [
      ['q0', 'q1', 'q2', 'q3'],
      ['q4', 'q5', 'q6', 'q7'],
    ];
    const chosen = selectQuestionIds(pool, history, 5, identity);
    expect(chosen).toContain('q8');
    expect(chosen).toContain('q9');
    // The three others come from the older tier (q0-q3), never from the newer one.
    const rest = chosen.filter((id) => id !== 'q8' && id !== 'q9');
    expect(rest).toHaveLength(3);
    expect(rest.every((id) => ['q0', 'q1', 'q2', 'q3'].includes(id))).toBe(true);
  });

  it('SEL4: a question served in several attempts counts by its latest one', () => {
    const history = [['q0', 'q1', 'q2', 'q3', 'q4'], ['q5', 'q6', 'q7', 'q8', 'q9'], ['q0']];
    // Nothing is unseen. q1-q4 were last served longest ago, then q5-q9, then q0.
    const chosen = selectQuestionIds(pool, history, 4, identity);
    expect([...chosen].sort()).toEqual(['q1', 'q2', 'q3', 'q4']);
    expect(selectQuestionIds(pool, history, 9, identity)).not.toContain('q0');
  });

  it('SEL5: the injected shuffle decides the order inside a tier and the final order', () => {
    const calls: number[] = [];
    const spy: ShuffleFn = (items) => {
      calls.push(items.length);
      return [...items].reverse();
    };
    const first = selectQuestionIds(pool, [], 3, spy);
    // identity picks q9,q8,q7 from the reversed tier; the final shuffle reverses them again.
    expect(first).toEqual(['q7', 'q8', 'q9']);
    expect(calls).toEqual([10, 3]);
    expect(selectQuestionIds(pool, [], 3, reverse)).toEqual(first);
    expect(selectQuestionIds(pool, [], 3, identity)).toEqual(['q0', 'q1', 'q2']);
  });

  it('SEL6: serves the whole pool when the count reaches its size', () => {
    expect([...selectQuestionIds(pool, [['q0']], 10, identity)].sort()).toEqual([...pool].sort());
    expect([...selectQuestionIds(pool, [], 25, identity)].sort()).toEqual([...pool].sort());
  });

  it('SEL7: ids outside the pool in the history are ignored', () => {
    const chosen = selectQuestionIds(pool, [['gone1', 'gone2', 'q0']], 9, identity);
    expect(chosen).not.toContain('q0');
    expect(chosen).toHaveLength(9);
  });

  it('SEL8: rejects an invalid count or an empty pool', () => {
    expect(() => selectQuestionIds(pool, [], 0, identity)).toThrow();
    expect(() => selectQuestionIds(pool, [], 1.5, identity)).toThrow();
    expect(() => selectQuestionIds([], [], 1, identity)).toThrow();
  });

  it('SEL9: property, over repeated attempts every question is served before any repeats', () => {
    const history: string[][] = [];
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const chosen = selectQuestionIds(pool, history, 5, identity);
      for (const id of chosen) expect(seen.has(id), `${id} repeated early`).toBe(false);
      chosen.forEach((id) => seen.add(id));
      history.push(chosen);
    }
    expect(seen.size).toBe(10);
  });
});
