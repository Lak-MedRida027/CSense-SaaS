import { Types, trusted } from 'mongoose';
import type { BadgeAwardSource, BadgeProgressDTO, MyBadgesDTO } from '@csense/shared';
import type { Logger } from 'pino';
import { Badge, BadgeAward, Module } from '../../models/index.js';
import { curriculumFor } from '../learning/curriculum.service.js';

export interface AwardedBadge {
  id: string;
  name: string;
  iconMotif: string;
}

export interface BadgesService {
  /**
   * Award the badge that defines `moduleId`, exactly once per employee (unique index). Returns the
   * badge (new or already held), or null when the module has no badge.
   */
  awardForModule(
    userId: string,
    moduleId: string,
    attemptId: string | null,
    at: Date,
    source?: BadgeAwardSource,
  ): Promise<AwardedBadge | null>;
  /** Badges of the current curriculum in order, then earned badges of modules outside it. */
  listForEmployee(userId: string): Promise<MyBadgesDTO>;
}

const isDuplicateKey = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;

export function createBadgesService(deps: { logger: Logger }): BadgesService {
  return {
    async awardForModule(userId, moduleId, attemptId, at, source = 'completion') {
      const badge = await Badge.findOne({ moduleId: new Types.ObjectId(moduleId) }).lean();
      if (!badge) {
        deps.logger.warn({ moduleId, userId }, 'Module completed but it has no badge to award');
        return null;
      }
      try {
        await BadgeAward.create({
          userId: new Types.ObjectId(userId),
          badgeId: badge._id,
          moduleId: badge.moduleId,
          attemptId: attemptId === null ? null : new Types.ObjectId(attemptId),
          source,
          awardedAt: at,
        });
      } catch (err) {
        // A concurrent or repeated award already exists: that is the same outcome.
        if (!isDuplicateKey(err)) throw err;
      }
      return { id: badge._id.toHexString(), name: badge.name, iconMotif: badge.iconMotif };
    },

    async listForEmployee(userId) {
      const owner = new Types.ObjectId(userId);
      const [curriculum, awards] = await Promise.all([
        curriculumFor(userId),
        BadgeAward.find({ userId: owner }).lean(),
      ]);
      const awardByBadge = new Map(awards.map((a) => [a.badgeId.toHexString(), a]));
      const moduleIds = curriculum.map((c) => new Types.ObjectId(c.id));
      const earnedModuleIds = awards.map((a) => a.moduleId);
      const badges = await Badge.find({
        moduleId: trusted({ $in: [...moduleIds, ...earnedModuleIds] }),
      }).lean();
      const byModule = new Map(badges.map((b) => [b.moduleId.toHexString(), b]));

      const items: BadgeProgressDTO[] = [];
      const listed = new Set<string>();
      curriculum.forEach((entry, index) => {
        const badge = byModule.get(entry.id);
        if (!badge) return;
        const award = awardByBadge.get(badge._id.toHexString());
        listed.add(badge._id.toHexString());
        items.push({
          badgeId: badge._id.toHexString(),
          name: badge.name,
          iconMotif: badge.iconMotif,
          moduleId: entry.id,
          moduleTitle: entry.title,
          position: index + 1,
          earned: award !== undefined,
          earnedAt: award ? award.awardedAt.toISOString() : null,
        });
      });

      // Earned badges of modules that left the curriculum stay visible.
      const outside = awards.filter((a) => !listed.has(a.badgeId.toHexString()));
      if (outside.length > 0) {
        const mods = await Module.find({ _id: trusted({ $in: outside.map((a) => a.moduleId) }) })
          .select('title')
          .lean();
        const titles = new Map(mods.map((m) => [m._id.toHexString(), m.title]));
        for (const award of outside) {
          const badge = badges.find((b) => b._id.equals(award.badgeId));
          if (!badge) continue;
          items.push({
            badgeId: badge._id.toHexString(),
            name: badge.name,
            iconMotif: badge.iconMotif,
            moduleId: award.moduleId.toHexString(),
            moduleTitle: titles.get(award.moduleId.toHexString()) ?? 'Module',
            position: null,
            earned: true,
            earnedAt: award.awardedAt.toISOString(),
          });
        }
      }
      return {
        items,
        earnedCount: items.filter((i) => i.earned).length,
        totalCount: items.length,
      };
    },
  };
}
