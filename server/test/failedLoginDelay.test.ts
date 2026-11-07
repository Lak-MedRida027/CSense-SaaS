import { describe, expect, it } from 'vitest';
import {
  enforceFailedLoginFloor,
  FailedLoginFloor,
  jitterBound,
  realTiming,
  type Timing,
} from '../src/features/auth/failedLoginDelay.js';

function fake(jitterValue = 0) {
  let now = 0;
  const sleeps: number[] = [];
  const maxima: number[] = [];
  const timing: Timing = {
    now: () => now,
    sleep: (ms) => {
      sleeps.push(ms);
      now += ms;
      return Promise.resolve();
    },
    jitter: (max) => {
      maxima.push(max);
      return jitterValue;
    },
  };
  return {
    timing,
    sleeps,
    maxima,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('failed login floor', () => {
  it('FD1: sleeps for the floor plus jitter when the work was instant', async () => {
    const f = fake(5);
    await enforceFailedLoginFloor(f.timing, 0, 1000);
    expect(f.sleeps).toEqual([1005]);
  });

  it('FD2: sleeps only the remainder when the work already took part of the floor', async () => {
    const f = fake(0);
    f.advance(400);
    await enforceFailedLoginFloor(f.timing, 0, 1000);
    expect(f.sleeps).toEqual([600]);
  });

  it('FD3: does not sleep when the work already exceeded floor and jitter', async () => {
    const f = fake(10);
    f.advance(2000);
    await enforceFailedLoginFloor(f.timing, 0, 1000);
    expect(f.sleeps).toEqual([]);
  });

  it('FD4: a floor of 0 disables the delay and draws no jitter', async () => {
    const f = fake(10);
    await enforceFailedLoginFloor(f.timing, 0, 0);
    expect(f.sleeps).toEqual([]);
    expect(f.maxima).toEqual([]);
  });

  it('FD5: jitter is bounded to 10% of the floor and at most 100 ms', () => {
    expect(jitterBound(1000)).toBe(100);
    expect(jitterBound(5000)).toBe(100);
    expect(jitterBound(200)).toBe(20);
    expect(jitterBound(5)).toBe(0);
  });

  it('FD6: the real jitter source stays within bounds', () => {
    for (let i = 0; i < 200; i += 1) {
      const j = realTiming.jitter(101);
      expect(j).toBeGreaterThanOrEqual(0);
      expect(j).toBeLessThanOrEqual(100);
    }
    expect(realTiming.jitter(1)).toBe(0);
  });
});

describe('FailedLoginFloor', () => {
  it('FD7: calibration sets the floor to 3x the median compare time when that exceeds the base', async () => {
    let now = 0;
    const costs = [700, 900, 800];
    const timing: Timing = {
      now: () => now,
      sleep: () => Promise.resolve(),
      jitter: () => 0,
    };
    const floor = new FailedLoginFloor(1000);
    const effective = await floor.calibrate(timing, () => {
      now += costs.shift() ?? 0;
      return Promise.resolve();
    });
    expect(effective).toBe(2400);
    expect(floor.effectiveMs).toBe(2400);
  });

  it('FD8: calibration never lowers the configured floor; a base of 0 disables everything', async () => {
    const timing: Timing = { now: () => 0, sleep: () => Promise.resolve(), jitter: () => 0 };
    const floor = new FailedLoginFloor(1000);
    expect(await floor.calibrate(timing, () => Promise.resolve())).toBe(1000);
    const off = new FailedLoginFloor(0);
    off.record(5000);
    expect(await off.calibrate(timing, () => Promise.resolve())).toBe(0);
    expect(off.effectiveMs).toBe(0);
  });

  it('FD9: the floor tracks the largest recent failed-login work plus a margin, and is capped', () => {
    const floor = new FailedLoginFloor(1000);
    floor.record(1500);
    expect(floor.effectiveMs).toBeGreaterThanOrEqual(1650);
    expect(floor.effectiveMs).toBeLessThanOrEqual(1651);
    floor.record(100_000);
    expect(floor.effectiveMs).toBe(15_000);
    for (let i = 0; i < 40; i += 1) floor.record(10);
    expect(floor.effectiveMs).toBe(1000);
  });
});
