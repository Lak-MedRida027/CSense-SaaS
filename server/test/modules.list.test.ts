import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { learningOverviewSchema } from '@csense/shared';
import { UserProgress } from '../src/models/index.js';
import {
  bearer,
  buildTestApp,
  createAdmin,
  loginOk,
  makeCredentials,
  type TestApp,
} from './helpers/fixtures.js';
import {
  createCurriculum,
  createFinalTest,
  passModule,
  signedInEmployee,
} from './helpers/learningFixtures.js';

let t: TestApp;
let creds: { password: string; hash: string };

beforeAll(async () => {
  t = await buildTestApp();
  creds = await makeCredentials();
  await UserProgress.syncIndexes();
});

describe('GET /modules', () => {
  it('ML-L1: a new employee sees module 1 unlocked, the rest locked, the final test locked', async () => {
    const { modules, keys } = await createCurriculum({ count: 4 });
    await createFinalTest(keys, 3);
    const emp = await signedInEmployee(t.app, creds);

    const res = await emp.get('/modules');
    expect(res.status).toBe(200);
    const body = learningOverviewSchema.parse(res.body);

    expect(body.totalModules).toBe(4);
    expect(body.completedCount).toBe(0);
    expect(body.nextModuleId).toBe(modules[0]?.id);
    expect(body.modules.map((m) => m.status)).toEqual(['unlocked', 'locked', 'locked', 'locked']);
    expect(body.modules.map((m) => m.position)).toEqual([1, 2, 3, 4]);
    expect(body.modules[0]?.lockedBy).toBeNull();
    expect(body.modules[2]?.lockedBy).toEqual({
      moduleId: modules[0]?.id,
      position: 1,
      title: 'Module 1',
    });
    expect(body.finalTest).toMatchObject({
      status: 'locked',
      remainingModules: 4,
      questionCount: 3,
      attempts: 0,
      bestScore: null,
      passed: false,
    });
  });

  it('ML-L2: unpublished modules are absent and positions stay contiguous', async () => {
    const { modules } = await createCurriculum({ count: 4, published: [true, false, true, true] });
    const emp = await signedInEmployee(t.app, creds);
    const body = learningOverviewSchema.parse((await emp.get('/modules')).body);
    expect(body.modules.map((m) => m.title)).toEqual(['Module 1', 'Module 3', 'Module 4']);
    expect(body.modules.map((m) => m.position)).toEqual([1, 2, 3]);
    expect(body.modules.map((m) => m.id)).not.toContain(modules[1]?.id);
    expect(body.finalTest).toBeNull();
  });

  it('ML-L3: bestScore and attempts reflect the history', async () => {
    const { modules, keys } = await createCurriculum({ count: 2 });
    const emp = await signedInEmployee(t.app, creds);
    const first = modules[0];
    if (!first) throw new Error('fixture');
    await passModule(emp, first, keys);

    const body = learningOverviewSchema.parse((await emp.get('/modules')).body);
    expect(body.modules[0]).toMatchObject({
      status: 'completed',
      attempts: 1,
      bestScore: 100,
      passed: true,
    });
    expect(body.modules[0]?.completedAt).toEqual(expect.any(String));
    expect(body.modules[1]).toMatchObject({ status: 'unlocked', attempts: 0, bestScore: null });
    expect(body.completedCount).toBe(1);
    expect(body.nextModuleId).toBe(modules[1]?.id);
  });

  it('ML-L4: an administrator token gets 403 and no token gets 401', async () => {
    const admin = await createAdmin(creds);
    const { accessToken } = await loginOk(t.app, admin);
    const denied = await request(t.app)
      .get('/api/v1/modules')
      .set(...bearer(accessToken));
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
    expect((await request(t.app).get('/api/v1/modules')).status).toBe(401);
  });

  it('with no modules at all the overview is empty and the final test is locked or absent', async () => {
    const emp = await signedInEmployee(t.app, creds);
    const body = learningOverviewSchema.parse((await emp.get('/modules')).body);
    expect(body).toMatchObject({
      modules: [],
      totalModules: 0,
      nextModuleId: null,
      finalTest: null,
    });
  });
});
