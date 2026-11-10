import { beforeAll, describe, expect, it } from 'vitest';
import { moduleProgressSchema } from '@csense/shared';
import { UserProgress } from '../src/models/index.js';
import { buildTestApp, makeCredentials, type TestApp } from './helpers/fixtures.js';
import { createCurriculum, passModule, signedInEmployee } from './helpers/learningFixtures.js';

let t: TestApp;
let creds: { password: string; hash: string };

beforeAll(async () => {
  t = await buildTestApp();
  creds = await makeCredentials();
  await UserProgress.syncIndexes();
});

describe('POST /modules/:moduleId/start', () => {
  it('ST1: creates an in_progress row and is idempotent', async () => {
    const { modules } = await createCurriculum({ count: 2 });
    const emp = await signedInEmployee(t.app, creds);
    const id = modules[0]?.id ?? '';

    const a = await emp.post(`/modules/${id}/start`);
    expect(a.status).toBe(200);
    const first = moduleProgressSchema.parse(a.body);
    expect(first.status).toBe('in_progress');
    expect(first.startedAt).toEqual(expect.any(String));
    expect(first.contentCompletedAt).toBeNull();

    const b = moduleProgressSchema.parse((await emp.post(`/modules/${id}/start`)).body);
    expect(b.startedAt).toBe(first.startedAt);
    expect(await UserProgress.countDocuments({ userId: emp.id })).toBe(1);
    const row = await UserProgress.findOne({ userId: emp.id }).lean();
    expect(row).toMatchObject({ status: 'in_progress', quizPassed: false, attempts: 0 });
  });

  it('ST2: a locked module is 403 and no row is created', async () => {
    const { modules } = await createCurriculum({ count: 2 });
    const emp = await signedInEmployee(t.app, creds);
    const res = await emp.post(`/modules/${modules[1]?.id ?? ''}/start`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MODULE_LOCKED');
    expect(await UserProgress.countDocuments({})).toBe(0);
  });

  it('ST3: starting a completed module does not change its status', async () => {
    const { modules, keys } = await createCurriculum({ count: 2 });
    const emp = await signedInEmployee(t.app, creds);
    const m = modules[0];
    if (!m) throw new Error('fixture');
    await passModule(emp, m, keys);
    const res = await emp.post(`/modules/${m.id}/start`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    const row = await UserProgress.findOne({ userId: emp.id, moduleId: m.id }).lean();
    expect(row).toMatchObject({ status: 'completed', quizPassed: true });
  });

  it('rejects a body that carries anything', async () => {
    const { modules } = await createCurriculum({ count: 1 });
    const emp = await signedInEmployee(t.app, creds);
    const res = await emp.post(`/modules/${modules[0]?.id ?? ''}/start`, { status: 'completed' });
    expect(res.status).toBe(400);
    expect(await UserProgress.countDocuments({})).toBe(0);
  });

  it('an unpublished module is 404 on start', async () => {
    const { modules } = await createCurriculum({ count: 2, published: [true, false] });
    const emp = await signedInEmployee(t.app, creds);
    expect((await emp.post(`/modules/${modules[1]?.id ?? ''}/start`)).status).toBe(404);
  });
});
