import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { learningOverviewSchema } from '@csense/shared';
import { Module, UserProgress } from '../src/models/index.js';
import { buildTestApp, makeCredentials, type TestApp } from './helpers/fixtures.js';
import {
  completeContent,
  createCurriculum,
  passModule,
  signedInEmployee,
  syncLearningIndexes,
} from './helpers/learningFixtures.js';

let t: TestApp;
let creds: { password: string; hash: string };

beforeAll(async () => {
  t = await buildTestApp();
  creds = await makeCredentials();
  await syncLearningIndexes();
});

const statuses = async (emp: { get: (p: string) => Promise<{ body: unknown }> }) =>
  learningOverviewSchema.parse((await emp.get('/modules')).body).modules.map((m) => m.status);

describe('progression under content changes (direct DB edits until Phase 7)', () => {
  it('PR1: unpublishing module 2 lets someone who passed 1 open module 3', async () => {
    const { modules, keys } = await createCurriculum({ count: 3 });
    const [m1, m2, m3] = modules;
    if (!m1 || !m2 || !m3) throw new Error('fixture');
    const emp = await signedInEmployee(t.app, creds);
    await passModule(emp, m1, keys);
    expect(await statuses(emp)).toEqual(['completed', 'unlocked', 'locked']);
    expect((await emp.get(`/modules/${m3.id}`)).status).toBe(403);

    await Module.updateOne({ _id: m2.id }, { isPublished: false });
    expect(await statuses(emp)).toEqual(['completed', 'unlocked']);
    expect((await emp.get(`/modules/${m2.id}`)).status).toBe(404);
    expect((await emp.get(`/modules/${m3.id}`)).status).toBe(200);
  });

  it('PR2: moving an unpassed module ahead re-locks a started later module and keeps its facts', async () => {
    const { modules, keys } = await createCurriculum({ count: 3 });
    const [m1, m2, m3] = modules;
    if (!m1 || !m2 || !m3) throw new Error('fixture');
    const emp = await signedInEmployee(t.app, creds);
    await passModule(emp, m1, keys);
    await completeContent(emp, m2);
    expect(await statuses(emp)).toEqual(['completed', 'in_progress', 'locked']);

    // Module 3 is moved to the front (driver write: the unique order index forbids a plain swap).
    await Module.collection.updateOne({ _id: new Types.ObjectId(m3.id) }, { $set: { order: 0 } });
    // The overview is ordered by position: m3, m1, m2.
    const overview = learningOverviewSchema.parse((await emp.get('/modules')).body);
    expect(overview.modules.map((m) => [m.title, m.status, m.position])).toEqual([
      ['Module 3', 'unlocked', 1],
      ['Module 1', 'completed', 2],
      ['Module 2', 'locked', 3],
    ]);
    expect(overview.modules[2]?.lockedBy).toMatchObject({ title: 'Module 3', position: 1 });
    expect((await emp.get(`/modules/${m2.id}`)).status).toBe(403);

    const row = await UserProgress.findOne({ userId: emp.id, moduleId: m2.id }).lean();
    expect(row?.contentCompletedAt).toBeInstanceOf(Date);
    expect(row?.status).toBe('in_progress');

    // Once module 3 is passed, module 2 opens again with its facts intact.
    await passModule(emp, m3, keys);
    expect(await statuses(emp)).toEqual(['completed', 'completed', 'in_progress']);
  });

  it('PR3: republishing a module keeps an earlier pass', async () => {
    const { modules, keys } = await createCurriculum({ count: 2 });
    const [m1] = modules;
    if (!m1) throw new Error('fixture');
    const emp = await signedInEmployee(t.app, creds);
    await passModule(emp, m1, keys);

    await Module.updateOne({ _id: m1.id }, { isPublished: false });
    expect(await statuses(emp)).toEqual(['unlocked']);
    await Module.updateOne({ _id: m1.id }, { isPublished: true });
    expect(await statuses(emp)).toEqual(['completed', 'unlocked']);
  });

  it('a module added at the front after everything was passed is the next frontier', async () => {
    const { modules, keys } = await createCurriculum({ count: 2 });
    const emp = await signedInEmployee(t.app, creds);
    for (const m of modules) await passModule(emp, m, keys);
    expect(await statuses(emp)).toEqual(['completed', 'completed']);

    await Module.collection.insertOne({
      order: 0,
      title: 'Fresh module',
      description: 'new',
      content: '',
      format: 'video',
      videoUrl: 'https://media.example.com/new.mp4',
      duration: 3,
      isPublished: true,
      transcript: [],
      keyTakeaways: [],
      exercises: [],
    });
    expect(await statuses(emp)).toEqual(['unlocked', 'completed', 'completed']);
  });
});
