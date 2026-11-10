import { Types, trusted } from 'mongoose';
import { computeXp, levelForXp, xpEarnedForAttempt, type XpResult } from '@csense/shared';
import { Employee } from '../../models/index.js';
import { loadXpFacts } from './xpFacts.service.js';

export interface XpUpdate {
  total: number;
  /** XP attributed to `attemptId`, when one was given. */
  xpEarned: number;
  result: XpResult;
}

export interface XpService {
  /**
   * Recompute total XP from attempt history and project it onto the employee. Monotone: the
   * conditional write only ever raises the stored total, so races converge on the maximum.
   * `force` (reconcile after a rule change) sets the value unconditionally.
   */
  recomputeXp(userId: string, opts?: { attemptId?: string; force?: boolean }): Promise<XpUpdate>;
}

export function createXpService(options: { timeZone?: string } = {}): XpService {
  return {
    async recomputeXp(userId, opts = {}) {
      const result = computeXp(await loadXpFacts(userId), {
        ...(options.timeZone ? { timeZone: options.timeZone } : {}),
      });
      const total = result.total;
      const set = { totalXP: total, level: levelForXp(total) };
      const id = new Types.ObjectId(userId);
      if (opts.force) {
        await Employee.updateOne({ _id: id }, { $set: set });
      } else {
        await Employee.updateOne({ _id: id, totalXP: trusted({ $lt: total }) }, { $set: set });
      }
      return {
        total,
        xpEarned: opts.attemptId ? xpEarnedForAttempt(result, opts.attemptId) : 0,
        result,
      };
    },
  };
}
