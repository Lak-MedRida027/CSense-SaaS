import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { moduleDetailSchema } from '@csense/shared';
import { buildTestApp, makeCredentials, type TestApp } from './helpers/fixtures.js';
import {
  completeContent,
  createCurriculum,
  passModule,
  scanForKeys,
  signedInEmployee,
  type TestModule,
} from './helpers/learningFixtures.js';
import { UserProgress } from '../src/models/index.js';

let t: TestApp;
let creds: { password: string; hash: string };

beforeAll(async () => {
  t = await buildTestApp();
  creds = await makeCredentials();
  await UserProgress.syncIndexes();
});

const first = (mods: TestModule[]): TestModule => {
  const m = mods[0];
  if (!m) throw new Error('fixture');
  return m;
};

describe('GET /modules/:moduleId', () => {
  it('MD1: an accessible module returns content with no key fields anywhere', async () => {
    const { modules } = await createCurriculum({ count: 2, interactive: [1] });
    const emp = await signedInEmployee(t.app, creds);
    const res = await emp.get(`/modules/${first(modules).id}`);
    expect(res.status).toBe(200);
    const body = moduleDetailSchema.parse(res.body);
    expect(scanForKeys(res.body)).toEqual([]);
    expect(JSON.stringify(res.body)).not.toMatch(/Exercise explanation/);
    expect(body.content.exercises).toHaveLength(2);
    expect(body.content.exercises[0]).toEqual({
      exerciseId: first(modules).exerciseIds[0],
      prompt: 'Exercise 1.0',
      artifact: null,
      options: ['Yes', 'No'],
    });
    expect(body.content.body).toBe('Lesson text 1');
    expect(body.content.keyTakeaways).toEqual(['Remember this']);
    expect(body.quiz).toMatchObject({ questionCount: 5, canStart: false });
  });

  it('MD1b: a video module carries the url, captions and indexed transcript cues', async () => {
    const { modules } = await createCurriculum({ count: 1 });
    const emp = await signedInEmployee(t.app, creds);
    const body = moduleDetailSchema.parse((await emp.get(`/modules/${first(modules).id}`)).body);
    expect(body.content.video).toEqual({
      url: 'https://media.example.com/m1.mp4',
      captionsUrl: 'https://media.example.com/m1.vtt',
      transcript: [{ id: 0, startSeconds: 0, text: 'Welcome.' }],
    });
  });

  it('MD2: a locked module is 403 MODULE_LOCKED and the body carries no content', async () => {
    const { modules } = await createCurriculum({ count: 3 });
    const emp = await signedInEmployee(t.app, creds);
    const res = await emp.get(`/modules/${modules[2]?.id ?? ''}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MODULE_LOCKED');
    expect(JSON.stringify(res.body)).not.toMatch(/Lesson text|Module 3|media\.example/);
  });

  it('MD3: unpublished or unknown is 404, an invalid id is 400, an operator id is 400', async () => {
    const { modules } = await createCurriculum({ count: 2, published: [true, false] });
    const emp = await signedInEmployee(t.app, creds);
    expect((await emp.get(`/modules/${modules[1]?.id ?? ''}`)).status).toBe(404);
    expect((await emp.get(`/modules/${new Types.ObjectId().toHexString()}`)).status).toBe(404);
    const bad = await emp.get('/modules/not-an-id');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect((await emp.get('/modules/%7B%22%24ne%22%3A1%7D')).status).toBe(400);
  });

  it('MD4: a completed module stays readable', async () => {
    const { modules, keys } = await createCurriculum({ count: 2 });
    const emp = await signedInEmployee(t.app, creds);
    await passModule(emp, first(modules), keys);
    const res = await emp.get(`/modules/${first(modules).id}`);
    expect(res.status).toBe(200);
    const body = moduleDetailSchema.parse(res.body);
    expect(body.module.status).toBe('completed');
    expect(body.quiz).toMatchObject({
      passed: true,
      canStart: false,
      blockedReason: 'already_passed',
    });
  });

  it('MD5: quiz.blockedReason follows the unlock rules', async () => {
    const { modules } = await createCurriculum({ count: 2, interactive: [1] });
    const emp = await signedInEmployee(t.app, creds);
    const m = first(modules);
    const before = moduleDetailSchema.parse((await emp.get(`/modules/${m.id}`)).body);
    expect(before.quiz).toMatchObject({ canStart: false, blockedReason: 'content_incomplete' });

    // A locked module's quiz overview is refused outright.
    const locked = await emp.get(`/modules/${modules[1]?.id ?? ''}/quiz`);
    expect(locked.status).toBe(403);
    expect(locked.body.error.code).toBe('MODULE_LOCKED');

    await completeContent(emp, m);
    const after = moduleDetailSchema.parse((await emp.get(`/modules/${m.id}`)).body);
    expect(after.quiz).toMatchObject({ canStart: true, blockedReason: null });
    expect(after.progress.contentCompletedAt).toEqual(expect.any(String));
    expect(after.progress.exerciseAnswers).toHaveLength(2);
  });
});
