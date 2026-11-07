import { Writable } from 'node:stream';
import { Types } from 'mongoose';
import { pino } from 'pino';
import { beforeAll, describe, expect, it } from 'vitest';
import { attemptResultSchema } from '@csense/shared';
import { createGamificationServices } from '../src/features/gamification/services.js';
import { Badge, BadgeAward, Employee, UserProgress } from '../src/models/index.js';
import { makeCredentials } from './helpers/fixtures.js';
import {
  completeContent,
  createCurriculum,
  createFinalTest,
  passModule,
  signedInEmployee,
  startQuiz,
  submitQuiz,
  syncLearningIndexes,
  type TestCurriculum,
} from './helpers/learningFixtures.js';
import { buildGamificationApp, seedBadgesFor } from './helpers/riskFixtures.js';
import { testConfig } from './helpers/testConfig.js';

let creds: { password: string; hash: string };

beforeAll(async () => {
  creds = await makeCredentials();
  await syncLearningIndexes();
});

const totalXp = async (userId: string) =>
  (await Employee.findById(userId).select('totalXP level').lean()) ?? { totalXP: -1, level: '' };

const first = <T>(items: T[]): T => {
  const item = items[0];
  if (item === undefined) throw new Error('fixture');
  return item;
};

describe('module completion awards XP and a badge exactly once', () => {
  it('GA1: a first-try perfect pass gives 300 XP, the badge, level Aware and one award', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 2 });
    await seedBadgesFor(cur);
    const emp = await signedInEmployee(t.app, creds);
    const result = await passModule(emp, first(cur.modules), cur.keys);

    const dto = attemptResultSchema.parse(result.body);
    expect(dto.effects.xpEarned).toBe(300);
    expect(dto.effects.badge).toMatchObject({ name: 'Badge 1', iconMotif: 'shield' });
    expect(await totalXp(emp.id)).toMatchObject({ totalXP: 300, level: 'Aware' });
    expect(await BadgeAward.countDocuments({ userId: emp.id })).toBe(1);
    const award = await BadgeAward.findOne({ userId: emp.id }).lean();
    expect(award?.source).toBe('completion');
    expect(award?.attemptId?.toHexString()).toBe(dto.attemptId);
  });

  it('GA2: replaying the same submission is a 409 and changes nothing', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 1 });
    await seedBadgesFor(cur);
    const m1 = first(cur.modules);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    const body = {
      sessionId: session.sessionId,
      answers: session.questions.map((q) => ({
        questionId: q.questionId,
        selectedIndex: cur.keys.get(q.questionId) ?? 0,
      })),
    };
    expect((await emp.post(`/modules/${m1.id}/quiz/attempts`, body)).status).toBe(201);
    const replay = await emp.post(`/modules/${m1.id}/quiz/attempts`, body);
    expect(replay.status).toBe(409);
    expect(await totalXp(emp.id)).toMatchObject({ totalXP: 300 });
    expect(await BadgeAward.countDocuments()).toBe(1);
  });

  it('GA3: two concurrent submits on one session give one 201, one award and 300 XP', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 1 });
    await seedBadgesFor(cur);
    const m1 = first(cur.modules);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    const body = {
      sessionId: session.sessionId,
      answers: session.questions.map((q) => ({
        questionId: q.questionId,
        selectedIndex: cur.keys.get(q.questionId) ?? 0,
      })),
    };
    const results = await Promise.all([
      emp.post(`/modules/${m1.id}/quiz/attempts`, body),
      emp.post(`/modules/${m1.id}/quiz/attempts`, body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await BadgeAward.countDocuments()).toBe(1);
    expect(await totalXp(emp.id)).toMatchObject({ totalXP: 300 });
  });

  it('GA4: redelivering the completion event gives the same answer and changes nothing', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 1 });
    await seedBadgesFor(cur);
    const m1 = first(cur.modules);
    const emp = await signedInEmployee(t.app, creds);
    const result = await passModule(emp, m1, cur.keys);
    const event = {
      userId: emp.id,
      moduleId: m1.id,
      attemptId: result.body.attemptId as string,
      attemptNumber: 1,
      score: 100,
      at: new Date(),
    };
    const a = await t.g.hooks.onModuleCompleted(event);
    const b = await t.g.hooks.onModuleCompleted(event);
    expect(a?.xpEarned).toBe(300);
    expect(b).toEqual(a);
    expect(a?.badge?.name).toBe('Badge 1');
    expect(await BadgeAward.countDocuments()).toBe(1);
    expect(await totalXp(emp.id)).toMatchObject({ totalXP: 300 });
  });

  it('GA5: five failures then a pass at 80 earns 150 and the failures earn nothing', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 1 });
    await seedBadgesFor(cur);
    const m1 = first(cur.modules);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    for (let i = 0; i < 5; i += 1) {
      const { session } = await startQuiz(emp, m1.id);
      const failed = await submitQuiz(emp, m1.id, session, cur.keys, 1);
      expect(failed.body.passed).toBe(false);
      expect(failed.body.effects).toEqual({});
    }
    expect(await totalXp(emp.id)).toMatchObject({ totalXP: 0, level: 'Apprentice' });
    const { session } = await startQuiz(emp, m1.id);
    const pass = await submitQuiz(emp, m1.id, session, cur.keys, 4);
    expect(pass.body.passed).toBe(true);
    expect(pass.body.effects.xpEarned).toBe(150);
    expect(await totalXp(emp.id)).toMatchObject({ totalXP: 150 });
  });

  it('GA6: abandoning the first session forfeits the first-try bonus (150 + 50 for a perfect pass)', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 1 });
    await seedBadgesFor(cur);
    const m1 = first(cur.modules);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session: s1 } = await startQuiz(emp, m1.id);
    expect((await emp.post(`/modules/${m1.id}/quiz/sessions/${s1.sessionId}/abandon`)).status).toBe(
      201,
    );
    const { session } = await startQuiz(emp, m1.id);
    const pass = await submitQuiz(emp, m1.id, session, cur.keys, 5);
    expect(pass.body.effects.xpEarned).toBe(200);
    expect(await totalXp(emp.id)).toMatchObject({ totalXP: 200 });
  });

  it('GA6b: practice answers add 10 XP each once the module is passed (1 correct, first try at 80: 260)', async () => {
    const t = await buildGamificationApp();
    const cur = await createCurriculum({ count: 1, interactive: [1] });
    await seedBadgesFor(cur);
    const m1 = first(cur.modules);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1); // exercise 0 is answered correctly, exercise 1 wrongly
    expect(
      (await UserProgress.findOne({ userId: emp.id }).lean())?.exerciseAnswers.filter(
        (a) => a.correct,
      ),
    ).toHaveLength(1);
    const { session } = await startQuiz(emp, m1.id);
    const pass = await submitQuiz(emp, m1.id, session, cur.keys, 4);
    expect(pass.body.effects.xpEarned).toBe(260);
    expect(await totalXp(emp.id)).toMatchObject({ totalXP: 260 });
  });

  it('GA7: a module without a badge earns XP only, logs a warning, and reconcile awards the badge later', async () => {
    const lines: string[] = [];
    const logger = pino(
      { level: 'warn' },
      new Writable({
        write(chunk: Buffer, _enc, cb) {
          lines.push(chunk.toString());
          cb();
        },
      }),
    );
    const config = testConfig();
    const clockNow = () => new Date();
    const g = createGamificationServices({ config, clock: clockNow, logger });
    const t = await buildGamificationApp({}, { gamification: g });
    const cur = await createCurriculum({ count: 1 });
    const m1 = first(cur.modules);
    const emp = await signedInEmployee(t.app, creds);
    const result = await passModule(emp, m1, cur.keys);
    expect(result.body.effects).toEqual({ xpEarned: 300 });
    expect(lines.join('')).toContain('no badge to award');
    expect(await BadgeAward.countDocuments()).toBe(0);

    await seedBadgesFor(cur);
    const diff = await g.reconcile.reconcileUser(emp.id);
    expect(diff.badgesAwarded).toBe(1);
    const award = await BadgeAward.findOne({ userId: emp.id }).lean();
    const progress = await UserProgress.findOne({ userId: emp.id }).lean();
    expect(award?.source).toBe('reconcile');
    expect(award?.awardedAt.getTime()).toBe(progress?.completedAt?.getTime());
    expect((await g.reconcile.reconcileUser(emp.id)).drift).toBe(false);
  });

  it('GA8: passing the final test adds 700 and gives no badge', async () => {
    const t = await buildGamificationApp();
    const cur: TestCurriculum = await createCurriculum({ count: 2 });
    await seedBadgesFor(cur);
    await createFinalTest(cur.keys, 15);
    const emp = await signedInEmployee(t.app, creds);
    for (const m of cur.modules) await passModule(emp, m, cur.keys);
    expect(await totalXp(emp.id)).toMatchObject({ totalXP: 600 });

    const started = await emp.post('/final-test/sessions');
    expect(started.status).toBe(201);
    const answers = (started.body.questions as { questionId: string }[]).map((q) => ({
      questionId: q.questionId,
      selectedIndex: cur.keys.get(q.questionId) ?? 0,
    }));
    const done = await emp.post('/final-test/attempts', {
      sessionId: started.body.sessionId,
      answers,
    });
    expect(done.status).toBe(201);
    expect(done.body.effects).toEqual({ xpEarned: 700 });
    expect(await totalXp(emp.id)).toMatchObject({ totalXP: 1300, level: 'Practitioner' });
    expect(await BadgeAward.countDocuments()).toBe(2);
  });

  it('a stray award for an unknown badge cannot be created twice for one user', async () => {
    const userId = new Types.ObjectId();
    const badge = await Badge.create({
      name: 'X',
      moduleId: new Types.ObjectId(),
      iconMotif: 'star',
    });
    const t = await buildGamificationApp();
    const [a, b] = await Promise.all([
      t.g.badges.awardForModule(
        userId.toHexString(),
        badge.moduleId.toHexString(),
        null,
        new Date(),
      ),
      t.g.badges.awardForModule(
        userId.toHexString(),
        badge.moduleId.toHexString(),
        null,
        new Date(),
      ),
    ]);
    expect(a).toEqual(b);
    expect(await BadgeAward.countDocuments({ userId })).toBe(1);
  });
});
