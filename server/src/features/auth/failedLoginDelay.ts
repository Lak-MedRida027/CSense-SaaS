import { setTimeout as sleepMs } from 'node:timers/promises';
import { randomInt } from 'node:crypto';

/**
 * Minimum duration of a failed login (P2-L1). Stored hashes keep the bcrypt cost they were created
 * with, so after a BCRYPT_COST change a failed login for an existing account does more or less
 * work than the dummy-hash compare for an unknown email. A response-time floor larger than any
 * bcrypt compare hides that difference. Every failure branch waits out the same floor plus jitter.
 */
export interface Timing {
  /** Monotonic-enough millisecond clock. */
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Integer in [0, maxExclusive). */
  jitter: (maxExclusive: number) => number;
}

export const realTiming: Timing = {
  now: () => performance.now(),
  sleep: (ms) => sleepMs(ms),
  jitter: (max) => (max <= 1 ? 0 : randomInt(max)),
};

/** Jitter is up to 10% of the floor, at most 100 ms. */
export const jitterBound = (floorMs: number): number => Math.min(100, Math.floor(floorMs / 10));

/**
 * Sleeps until `floorMs` plus jitter has passed since `startedAt`. Resolves immediately when the
 * work itself already took longer. A floor of 0 disables the delay entirely.
 */
export async function enforceFailedLoginFloor(
  timing: Timing,
  startedAt: number,
  floorMs: number,
): Promise<void> {
  if (floorMs <= 0) return;
  const target = floorMs + timing.jitter(jitterBound(floorMs) + 1);
  const remaining = target - (timing.now() - startedAt);
  if (remaining > 0) await timing.sleep(remaining);
}

const SAMPLE_WINDOW = 32;
const MARGIN = 1.1;
const CALIBRATION_FACTOR = 3;
const CALIBRATION_RUNS = 3;
/** The adaptive floor never exceeds this, so a flood cannot make failures take arbitrarily long. */
const MAX_EFFECTIVE_MS = 15_000;

/**
 * The effective failure floor (P2-L6). A fixed floor stops masking once bcrypt work plus threadpool
 * queueing exceeds it (high BCRYPT_COST, start-up bursts). The effective floor is therefore
 * `max(configured, 3 x median startup compare time, 1.1 x the largest recent failed-login work)`.
 * Residual: under extreme sustained load the first slow failures can still precede adaptation.
 */
export class FailedLoginFloor {
  private calibratedMs = 0;
  private readonly samples: number[] = [];

  constructor(private readonly baseMs: number) {}

  get effectiveMs(): number {
    if (this.baseMs <= 0) return 0;
    const recent = this.samples.length > 0 ? Math.max(...this.samples) * MARGIN : 0;
    return Math.min(MAX_EFFECTIVE_MS, Math.ceil(Math.max(this.baseMs, this.calibratedMs, recent)));
  }

  /** Records how long the work of one failed login took (before any floor sleep). */
  record(workMs: number): void {
    this.samples.push(Math.max(0, workMs));
    if (this.samples.length > SAMPLE_WINDOW) this.samples.shift();
  }

  /** Times a few compares at the configured cost; returns the effective floor. */
  async calibrate(timing: Timing, compareOnce: () => Promise<unknown>): Promise<number> {
    if (this.baseMs <= 0) return 0;
    const durations: number[] = [];
    for (let i = 0; i < CALIBRATION_RUNS; i += 1) {
      const started = timing.now();
      await compareOnce();
      durations.push(timing.now() - started);
    }
    durations.sort((a, b) => a - b);
    this.calibratedMs = CALIBRATION_FACTOR * (durations[Math.floor(durations.length / 2)] ?? 0);
    return this.effectiveMs;
  }
}
