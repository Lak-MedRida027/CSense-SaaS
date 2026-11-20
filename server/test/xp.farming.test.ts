import { beforeAll, describe, expect, it } from 'vitest';
import { makeCredentials } from './helpers/fixtures.js';
import {
  completeContent,
  createCurriculum,
  failModule,
  passModule,
  signedInEmployee,
  startQuiz,
  syncLearningIndexes,
  type Client,
  type TestModule,
} from './helpers/learningFixtures.js';
import { buildGamificationApp } from './helpers/riskFixtures.js';

let creds: Awaited<ReturnType<typeof makeCredentials>>;

beforeAll(async () => {
  creds = await makeCredentials();
  await syncLearningIndexes();
});

const totalXp = async (c: Client): Promise<number> =>
  (await c.get('/me/xp')).body.totalXP as number;

/** Everything a client can repeat without a new graded pass. */
async function hammer(c: Client, mod: TestModule): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    await c.get(`/modules/${mod.id}`);
    await c.get('/modules');
    await c.post(`/modules/${mod.id}/start`);
    for (const exerciseId of mod.exerciseIds) {
      await c.post(`/modules/${mod.id}/exercises/${exerciseId}/answers`, {
        selectedIndex: round % 2,
      });
    }
    await c.post(`/modules/${mod.id}/content/complete`);
  }
  await c.patch('/me/onboarding', { outcome: 'completed' });
  await c.patch('/me/onboarding', { outcome: 'skipped' });
}

describe('XP cannot be farmed (Phase 6 E3/E4)', () => {
  it('XF1: repeated views, starts, exercise answers, content completes and onboarding writes never change XP', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 2, interactive: [1] });
    const mod = cur.modules[0];
    if (!mod) throw new Error('fixture');
    const c = await signedInEmployee(t.app, creds);

    await completeContent(c, mod);
    expect(await totalXp(c)).toBe(0);
    await hammer(c, mod);
    expect(await totalXp(c)).toBe(0);

    await passModule(c, mod, cur.keys);
    const afterPass = await totalXp(c);
    expect(afterPass).toBeGreaterThan(0);

    await hammer(c, mod);
    expect(await totalXp(c)).toBe(afterPass);
  });

  it('XF2: a passed module is credited once across retries and refused re-attempts', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 2 });
    const mod = cur.modules[0];
    if (!mod) throw new Error('fixture');
    const c = await signedInEmployee(t.app, creds);

    await failModule(c, mod, cur.keys);
    expect(await totalXp(c)).toBe(0);
    await passModule(c, mod, cur.keys);
    const afterPass = await totalXp(c);
    expect(afterPass).toBeGreaterThan(0);

    for (let i = 0; i < 3; i += 1) {
      const { res } = await startQuiz(c, mod.id);
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
    expect(await totalXp(c)).toBe(afterPass);
  });
});
