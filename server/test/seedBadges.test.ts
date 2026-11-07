import { beforeAll, describe, expect, it } from 'vitest';
import { BADGE_ICON_MOTIFS, badgeAuthoringSchema } from '@csense/shared';
import { Badge, Module } from '../src/models/index.js';
import { seedBadges } from '../src/scripts/seedBadges.js';
import { SeedRefusedError, seedLearningContent } from '../src/scripts/seedLearning.js';
import { SEED_BADGES } from '../src/scripts/seed/badgeContent.js';

beforeAll(async () => {
  await Promise.all([Module.syncIndexes(), Badge.syncIndexes()]);
});

describe('badge seed', () => {
  it('SB1: the seed content is valid, has one badge per module and no level names', () => {
    expect(Object.keys(SEED_BADGES).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const badge of Object.values(SEED_BADGES)) {
      expect(badgeAuthoringSchema.safeParse(badge).success).toBe(true);
      expect(BADGE_ICON_MOTIFS).toContain(badge.iconMotif);
      expect(badge.name).not.toMatch(/Apprentice|Aware|Practitioner|Guardian|Defender/);
    }
    expect(new Set(Object.values(SEED_BADGES).map((b) => b.name)).size).toBe(7);
  });

  it('SB2: creates the seven badges on the seeded modules; a second run keeps them', async () => {
    await seedLearningContent({ nodeEnv: 'test' });
    expect(await seedBadges({ nodeEnv: 'test' })).toEqual({ created: 7, kept: 0, skipped: 0 });
    const badges = await Badge.find({}).lean();
    const m1 = await Module.findOne({ order: 1 }).lean();
    expect(badges.find((b) => b.moduleId.equals(m1?._id))).toMatchObject({
      name: 'First Steps',
      iconMotif: 'welcome',
    });
    const before = JSON.stringify(await Badge.find({}).sort({ _id: 1 }).lean());
    expect(await seedBadges({ nodeEnv: 'test' })).toEqual({ created: 0, kept: 7, skipped: 0 });
    expect(JSON.stringify(await Badge.find({}).sort({ _id: 1 }).lean())).toBe(before);
  });

  it('SB3: concurrent runs end with seven badges (a duplicate counts as kept)', async () => {
    await seedLearningContent({ nodeEnv: 'test' });
    const runs = await Promise.all([1, 2, 3].map(() => seedBadges({ nodeEnv: 'test' })));
    expect(await Badge.countDocuments()).toBe(7);
    expect(runs.reduce((n, r) => n + r.created, 0)).toBe(7);
  });

  it('SB4: refuses production and an unset environment; skips badges whose module is missing', async () => {
    for (const env of ['production', undefined, 'staging', '']) {
      await expect(seedBadges({ nodeEnv: env })).rejects.toThrow(SeedRefusedError);
    }
    expect(await Badge.countDocuments()).toBe(0);
    expect(await seedBadges({ nodeEnv: 'development' })).toEqual({
      created: 0,
      kept: 0,
      skipped: 7,
    });
  });
});
