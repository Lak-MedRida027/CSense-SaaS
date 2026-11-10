import { beforeAll, describe, expect, it } from 'vitest';
import { LEVEL_THRESHOLDS, myBadgesSchema, xpSummarySchema } from '@csense/shared';
import { Module } from '../src/models/index.js';
import { makeCredentials } from './helpers/fixtures.js';
import {
  createCurriculum,
  passModule,
  signedInEmployee,
  syncLearningIndexes,
} from './helpers/learningFixtures.js';
import { adminClient, buildGamificationApp, seedBadgesFor } from './helpers/riskFixtures.js';

let creds: { password: string; hash: string };

beforeAll(async () => {
  creds = await makeCredentials();
  await syncLearningIndexes();
});

const first = <T>(items: T[]): T => {
  const item = items[0];
  if (item === undefined) throw new Error('fixture');
  return item;
};

describe('GET /me/xp and /me/badges', () => {
  it('MG1: before any pass: 0 XP, Apprentice, next Aware at 300, thresholds exact', async () => {
    const t = await buildGamificationApp();
    const emp = await signedInEmployee(t.app, creds);
    const res = await emp.get('/me/xp');
    expect(res.status).toBe(200);
    const xp = xpSummarySchema.parse(res.body);
    expect(xp).toEqual({
      totalXP: 0,
      level: 'Apprentice',
      tier: 1,
      currentLevelFloorXP: 0,
      nextLevel: 'Aware',
      nextLevelXP: 300,
      xpToNextLevel: 300,
      thresholds: { ...LEVEL_THRESHOLDS },
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('MG2: lists the curriculum badges in order, none earned, then one earned after module 1', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 3 });
    await seedBadgesFor(cur);
    const emp = await signedInEmployee(t.app, creds);
    const before = myBadgesSchema.parse((await emp.get('/me/badges')).body);
    expect(before.items.map((b) => b.position)).toEqual([1, 2, 3]);
    expect(before.items.map((b) => b.name)).toEqual(['Badge 1', 'Badge 2', 'Badge 3']);
    expect(before).toMatchObject({ earnedCount: 0, totalCount: 3 });
    expect(before.items.every((b) => !b.earned && b.earnedAt === null)).toBe(true);

    const passedAt = Date.now();
    await passModule(emp, first(cur.modules), cur.keys);
    const after = myBadgesSchema.parse((await emp.get('/me/badges')).body);
    expect(after.earnedCount).toBe(1);
    const earned = first(after.items);
    expect(earned.earned).toBe(true);
    expect(new Date(earned.earnedAt ?? 0).getTime()).toBeGreaterThanOrEqual(passedAt - 5000);
    expect((await emp.get('/me/xp')).body.totalXP).toBe(300);
  });

  it('MG3: one employee never sees another employee XP or badges', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 2 });
    await seedBadgesFor(cur);
    const a = await signedInEmployee(t.app, creds);
    const b = await signedInEmployee(t.app, creds);
    await passModule(a, first(cur.modules), cur.keys);
    expect((await a.get('/me/xp')).body.totalXP).toBe(300);
    expect((await b.get('/me/xp')).body.totalXP).toBe(0);
    const bBadges = myBadgesSchema.parse((await b.get('/me/badges')).body);
    expect(bBadges.earnedCount).toBe(0);
    // Identity comes from the token: a user id in the query is rejected, not honoured.
    expect((await b.get(`/me/xp?userId=${a.id}`)).status).toBe(400);
    expect((await b.get(`/me/badges?userId=${a.id}`)).status).toBe(400);
  });

  it('MG4: an earned badge of a module that left the curriculum stays listed with no position', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 2 });
    await seedBadgesFor(cur);
    const emp = await signedInEmployee(t.app, creds);
    const m1 = first(cur.modules);
    await passModule(emp, m1, cur.keys);
    await Module.updateOne({ _id: m1.id }, { $set: { isPublished: false } });
    const badges = myBadgesSchema.parse((await emp.get('/me/badges')).body);
    const gone = badges.items.find((b) => b.moduleId === m1.id);
    expect(gone).toMatchObject({ earned: true, position: null, moduleTitle: 'Module 1' });
    expect(badges.items.filter((b) => b.position !== null)).toHaveLength(1);
    expect(badges.totalCount).toBe(badges.items.length);
    // The pass still counts for XP.
    expect((await emp.get('/me/xp')).body.totalXP).toBe(300);
  });

  it('MG5: an administrator token is 403, no token is 401, an unknown query parameter is 400', async () => {
    const t = await buildGamificationApp();
    const admin = await adminClient(t.app, creds);
    const emp = await signedInEmployee(t.app, creds);
    for (const path of ['/me/xp', '/me/badges']) {
      expect((await admin.get(path)).status).toBe(403);
      expect((await emp.get(`${path}?nope=1`)).status).toBe(400);
    }
    const { default: request } = await import('supertest');
    expect((await request(t.app).get('/api/v1/me/xp')).status).toBe(401);
    expect((await request(t.app).get('/api/v1/me/badges')).status).toBe(401);
    // There is deliberately no /me/risk (D4-22).
    expect((await emp.get('/me/risk')).status).toBe(404);
  });
});
