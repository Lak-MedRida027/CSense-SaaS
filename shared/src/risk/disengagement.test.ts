import { describe, expect, it } from 'vitest';
import { decideDisengagement, stallAnchorMs, type DisengagementFacts } from './disengagement.js';

const DAY = 86_400_000;
const base: DisengagementFacts = {
  nowMs: 100 * DAY,
  afterDays: 14,
  anchorMs: 80 * DAY,
  assessed: false,
  hasCurriculum: true,
  finished: false,
  alreadyActive: false,
};

describe('decideDisengagement', () => {
  it('DG1: flags exactly at the boundary, not a millisecond before', () => {
    expect(decideDisengagement({ ...base, anchorMs: 86 * DAY })).toBe('disengaged_unassessed');
    expect(decideDisengagement({ ...base, anchorMs: 86 * DAY + 1 })).toBeNull();
  });

  it('DG2: the reason says whether the employee was ever assessed', () => {
    expect(decideDisengagement({ ...base, assessed: true })).toBe('disengaged_no_progress');
    expect(decideDisengagement({ ...base, assessed: false })).toBe('disengaged_unassessed');
  });

  it('DG3: nothing to flag when finished, with no curriculum, or when one is already open', () => {
    expect(decideDisengagement({ ...base, finished: true })).toBeNull();
    expect(decideDisengagement({ ...base, hasCurriculum: false })).toBeNull();
    expect(decideDisengagement({ ...base, alreadyActive: true })).toBeNull();
  });

  it('DG4: the anchor is the latest progress point; missing points are ignored', () => {
    expect(stallAnchorMs([1, null, 5, undefined, 3])).toBe(5);
    expect(stallAnchorMs([])).toBe(0);
  });
});
