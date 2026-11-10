import type { Logger } from 'pino';
import type { LearningHooks } from './learningHooks.js';
import type { Shuffle } from './shuffle.js';

/** Everything the learning services need from the app. */
export interface LearningDeps {
  clock: () => Date;
  sessionTtlSeconds: number;
  /** Per-hook time limit in ms. */
  hookTimeoutMs: number;
  /** A session start repeated inside this window returns the open session (0 disables). */
  startReuseSeconds: number;
  /** Consecutive failed attempts that start a cooldown. */
  cooldownAfterFails: number;
  cooldownMinutes: number;
  hooks: LearningHooks;
  logger: Logger;
  shuffle: Shuffle;
}

/** Request-derived context for log lines. */
export interface RequestInfo {
  requestId: string;
}
