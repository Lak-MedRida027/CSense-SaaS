import mongoose, { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { FINAL_TEST_TARGET_QUESTIONS, MODULE_QUIZ_TARGET_QUESTIONS } from '@csense/shared';
import {
  Assessment,
  AuditLog,
  FinalTest,
  Module,
  Quiz,
  QuizAttempt,
  UserProgress,
} from '../src/models/index.js';
import {
  SeedRefusedError,
  assertLocalMongo,
  databaseNameOf,
  seedAuthoringFindings,
  seedLearningContent,
  validateSeedContent,
} from '../src/scripts/seedLearning.js';
import {
  SEED_FINAL_TEST,
  SEED_MODULES,
  SEED_QUIZZES,
} from '../src/scripts/seed/learningContent.js';

beforeAll(async () => {
  await Promise.all([Module.syncIndexes(), Assessment.syncIndexes()]);
});

const seed = (extra: { reset?: boolean } = {}) =>
  seedLearningContent({
    nodeEnv: 'test',
    ...extra,
    ...(extra.reset ? { confirm: mongoose.connection.name } : {}),
  });

describe('learning seed', () => {
  it('SD1: an empty database gets 7 published modules, 7 quizzes of 5 and a final test of 15', async () => {
    const result = await seed();
    expect(result).toEqual({
      created: { modules: 7, quizzes: 7, finalTest: 1 },
      kept: { modules: 0, quizzes: 0, finalTest: 0 },
    });

    const modules = await Module.find({}).sort({ order: 1 }).lean();
    expect(modules.map((m) => m.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(modules.every((m) => m.isPublished)).toBe(true);
    expect(modules.map((m) => m.title)).toEqual([
      'Welcome to CSense',
      'Passwords and authentication',
      'Phishing',
      'Social engineering',
      'Safe browsing and downloads',
      'Protecting devices and data',
      'Reporting incidents',
    ]);
    expect(modules.map((m) => m.exercises.length)).toEqual([0, 4, 2, 4, 2, 4, 1]);
    expect(modules.map((m) => m.format)).toEqual([
      'video',
      'interactive',
      'video',
      'interactive',
      'video',
      'interactive',
      'video',
    ]);

    const quizzes = await Quiz.find({})
      .select('+questions.correctAnswer +questions.explanation')
      .lean();
    expect(quizzes).toHaveLength(7);
    const finalTest = await FinalTest.findOne()
      .select('+questions.correctAnswer +questions.explanation')
      .lean();
    expect(finalTest?.questions).toHaveLength(FINAL_TEST_TARGET_QUESTIONS);
    expect(finalTest?.passingScore).toBe(70);
    expect(finalTest?.questionsPerSession).toBe(15);

    const keyed = [...quizzes, ...(finalTest ? [finalTest] : [])];
    for (const a of keyed) {
      if (a.kind === 'Quiz') {
        expect(a.questions).toHaveLength(MODULE_QUIZ_TARGET_QUESTIONS);
        expect(a.questionsPerSession).toBe(5);
        expect(a.questions.length).toBeGreaterThanOrEqual(2 * (a.questionsPerSession ?? 1));
        expect(a.passingScore).toBe(70);
      }
      for (const question of a.questions) {
        expect(question.options.length).toBeGreaterThanOrEqual(3);
        expect(Number.isInteger(question.correctAnswer)).toBe(true);
        expect(question.correctAnswer).toBeGreaterThanOrEqual(0);
        expect(question.correctAnswer).toBeLessThan(question.options.length);
        expect(question.explanation.length).toBeGreaterThan(0);
        expect(question.explanation.length).toBeLessThanOrEqual(300);
      }
    }
    // Every quiz belongs to a different module.
    expect(new Set(quizzes.map((a) => String(a.moduleId))).size).toBe(7);
  });

  it('SD2: a second run creates nothing and leaves every document untouched', async () => {
    await seed();
    const before = await Promise.all([
      Module.find({}).sort({ order: 1 }).lean(),
      Assessment.find({}).sort({ kind: 1, title: 1 }).lean(),
    ]);
    const again = await seed();
    expect(again).toEqual({
      created: { modules: 0, quizzes: 0, finalTest: 0 },
      kept: { modules: 7, quizzes: 7, finalTest: 1 },
    });
    const after = await Promise.all([
      Module.find({}).sort({ order: 1 }).lean(),
      Assessment.find({}).sort({ kind: 1, title: 1 }).lean(),
    ]);
    expect(after[0].map((m) => m.updatedAt)).toEqual(before[0].map((m) => m.updatedAt));
    expect(after[1].map((a) => a.updatedAt)).toEqual(before[1].map((a) => a.updatedAt));
    expect(await Module.countDocuments({})).toBe(7);
    expect(await Assessment.countDocuments({})).toBe(8);
  });

  it('SD2b: existing content is never overwritten', async () => {
    await seed();
    await Module.updateOne({ order: 2 }, { title: 'Locally edited title' });
    await seed();
    expect((await Module.findOne({ order: 2 }).lean())?.title).toBe('Locally edited title');
  });

  it('SD3: a partially seeded database only gets its gaps filled', async () => {
    await seed();
    const m3 = await Module.findOne({ order: 3 }).select('_id').lean();
    const m5 = await Module.findOne({ order: 5 }).select('_id').lean();
    if (!m3 || !m5) throw new Error('fixture');
    await Module.deleteOne({ order: 3 });
    await Quiz.deleteOne({ moduleId: m3._id });
    await Quiz.deleteOne({ moduleId: m5._id });
    await FinalTest.deleteOne({});

    const result = await seed();
    expect(result).toEqual({
      created: { modules: 1, quizzes: 2, finalTest: 1 },
      kept: { modules: 6, quizzes: 5, finalTest: 0 },
    });
    expect(await Module.countDocuments({})).toBe(7);
    expect(await Quiz.countDocuments({})).toBe(7);
    expect(await FinalTest.countDocuments({})).toBe(1);
  });

  it('SD4: fails closed: production, unset and unknown NODE_ENV are all refused, nothing is written', async () => {
    for (const nodeEnv of ['production', undefined, '', 'staging', 'Development']) {
      await expect(seedLearningContent({ nodeEnv }), String(nodeEnv)).rejects.toBeInstanceOf(
        SeedRefusedError,
      );
    }
    await expect(
      seedLearningContent({
        nodeEnv: 'production',
        reset: true,
        confirm: mongoose.connection.name,
      }),
    ).rejects.toThrow(/NODE_ENV/);
    expect(await Module.countDocuments({})).toBe(0);
    expect(await Assessment.countDocuments({})).toBe(0);
    await expect(seedLearningContent({ nodeEnv: 'development' })).resolves.toBeDefined();
  });

  it('SD4b: --reset needs --confirm=<db name>; a wrong or missing confirmation wipes nothing', async () => {
    await seed();
    for (const confirm of [undefined, '', 'other', mongoose.connection.name.toUpperCase() + 'x']) {
      await expect(
        seedLearningContent({ nodeEnv: 'test', reset: true, confirm }),
        String(confirm),
      ).rejects.toBeInstanceOf(SeedRefusedError);
    }
    expect(await Module.countDocuments({})).toBe(7);
    expect(await AuditLog.countDocuments({ action: 'learning.seed.reset' })).toBe(0);
  });

  it('SD4c: a confirmed reset writes a critical audit entry', async () => {
    await seed({ reset: true });
    const entries = await AuditLog.find({ action: 'learning.seed.reset' }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      severity: 'critical',
      outcome: 'success',
      metadata: { database: mongoose.connection.name, nodeEnv: 'test' },
    });
  });

  it('SD4d: non-local MongoDB hosts are refused unless SEED_ALLOW_REMOTE is set', () => {
    for (const uri of [
      'mongodb://127.0.0.1:27017/csense',
      'mongodb://localhost/csense',
      'mongodb://user:pw@localhost:27017,127.0.0.1:27018/csense?replicaSet=rs0',
      'mongodb://[::1]:27017/csense',
    ]) {
      expect(() => {
        assertLocalMongo(uri, false);
      }, uri).not.toThrow();
    }
    for (const uri of [
      'mongodb://db.example.com:27017/csense',
      'mongodb+srv://cluster0.example.net/csense',
      'mongodb://localhost,db.example.com/csense',
      'mongodb://user:pw@db.example.com/csense',
      'mongodb://localhost.evil.example.com/csense',
    ]) {
      expect(() => {
        assertLocalMongo(uri, false);
      }, uri).toThrow(SeedRefusedError);
      expect(() => {
        assertLocalMongo(uri, true);
      }, uri).not.toThrow();
    }
  });

  it('SD4e: the database name comes from the URI path', () => {
    expect(databaseNameOf('mongodb://127.0.0.1:27017/csense')).toBe('csense');
    expect(databaseNameOf('mongodb://127.0.0.1:27017/csense?x=1')).toBe('csense');
    expect(databaseNameOf('mongodb://127.0.0.1:27017')).toBe('test');
    expect(databaseNameOf('mongodb://127.0.0.1:27017/')).toBe('test');
  });

  it('SD5: all content passes the authoring schemas and follows the authoring rules', () => {
    const { modules, quizzes, finalTest } = validateSeedContent();
    expect(modules).toHaveLength(7);
    expect(quizzes.size).toBe(7);
    expect(finalTest.questions).toHaveLength(30);
    expect(finalTest.questionsPerSession).toBe(15);

    const everyQuestion = [...quizzes.values(), finalTest].flatMap((a) => a.questions);
    expect(everyQuestion).toHaveLength(100);
    for (const item of [...everyQuestion, ...modules.flatMap((m) => m.exercises)]) {
      expect(item.options.length).toBeGreaterThanOrEqual(2);
      expect(item.explanation.length).toBeLessThanOrEqual(300);
    }
    // An explanation teaches the concept; it must not simply restate the correct option.
    for (const item of everyQuestion) {
      const correct = (item.options[item.correctAnswer] ?? '').toLowerCase();
      expect(item.explanation.toLowerCase(), item.text).not.toContain(correct);
    }
    // The key is spread over several slots in every quiz.
    for (const [order, quiz] of quizzes) {
      expect(
        new Set(quiz.questions.map((x) => x.correctAnswer)).size,
        `quiz ${String(order)}`,
      ).toBeGreaterThan(1);
    }
    expect(new Set(finalTest.questions.map((x) => x.correctAnswer)).size).toBeGreaterThan(2);
  });

  it('SD5a: the shared authoring check finds nothing in the seed (explanation echoes, key length, near-duplicates)', () => {
    expect(seedAuthoringFindings()).toEqual([]);
  });

  it('SD5b: placeholder media uses reserved domains only and the content carries no branding', () => {
    const urls = SEED_MODULES.flatMap((m) => [m.videoUrl, m.captionsUrl]).filter(
      (u): u is string => typeof u === 'string',
    );
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      const { protocol, hostname } = new URL(url);
      expect(protocol).toBe('https:');
      expect(hostname).toMatch(/(^|\.)example\.(com|net|org)$/);
    }
    const all = JSON.stringify({ SEED_MODULES, SEED_QUIZZES, SEED_FINAL_TEST });
    const hosts = [...all.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1] ?? '');
    for (const host of hosts) expect(host).toMatch(/(^|\.)example\.(com|net|org)$/);
  });

  it('seeded modules satisfy the publish invariant and validate as stored documents', async () => {
    await seed();
    for (const m of await Module.find({}).lean()) {
      if (m.format === 'video') expect(m.videoUrl).toMatch(/^https:\/\//);
      if (m.format === 'interactive') expect(m.exercises.length).toBeGreaterThan(0);
      expect(m.keyTakeaways).toHaveLength(3);
    }
    const videos = await Module.find({ format: 'video' }).lean();
    expect(videos.every((m) => m.transcript.length >= 4 && m.transcript.length <= 6)).toBe(true);
  });

  it('--reset clears modules, assessments, progress and attempts (through the driver) and reseeds', async () => {
    await seed();
    await UserProgress.create({ userId: new Types.ObjectId(), moduleId: new Types.ObjectId() });
    await QuizAttempt.create({
      userId: new Types.ObjectId(),
      type: 'Quiz',
      refId: new Types.ObjectId(),
      answers: [{ questionId: new Types.ObjectId(), selectedIndex: null, correct: false }],
      score: 0,
      passed: false,
      sessionId: new Types.ObjectId(),
      moduleId: new Types.ObjectId(),
      attemptNumber: 1,
      endReason: 'abandoned',
      correctCount: 0,
      totalCount: 1,
      passingScore: 70,
    });
    const result = await seed({ reset: true });
    expect(result.created).toEqual({ modules: 7, quizzes: 7, finalTest: 1 });
    expect(await UserProgress.countDocuments({})).toBe(0);
    expect(await QuizAttempt.countDocuments({})).toBe(0);
  });
});
