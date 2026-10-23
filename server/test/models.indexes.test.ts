import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  Assessment,
  Badge,
  Employee,
  FinalTest,
  Module,
  PhishingSimulation,
  Quiz,
  QuizAttempt,
  RiskProfile,
  User,
  UserProgress,
} from '../src/models/index.js';

const DUPLICATE_KEY = 11000;

const question = (correctAnswer: unknown = 0) => ({
  text: 'Which of these is a phishing sign?',
  options: ['Urgent tone', 'Known sender'],
  correctAnswer,
});

const employee = (email: string) => ({
  name: 'Test Employee',
  email,
  passwordHash: 'not-a-real-hash',
});

const moduleDoc = (order: number) => ({
  order,
  title: `Module ${String(order)}`,
  description: 'desc',
  format: 'video' as const,
  duration: 10,
});

beforeAll(async () => {
  const models = [
    User,
    Module,
    Badge,
    UserProgress,
    Assessment,
    QuizAttempt,
    RiskProfile,
    PhishingSimulation,
  ];
  await Promise.all(models.map((m) => m.syncIndexes()));
});

describe('unique indexes', () => {
  it('rejects a duplicate email, case-insensitively', async () => {
    await Employee.create(employee('Jane.Doe@Example.com'));
    await expect(Employee.create(employee('jane.doe@example.com'))).rejects.toMatchObject({
      code: DUPLICATE_KEY,
    });
  });

  it('rejects a duplicate module order', async () => {
    await Module.create(moduleDoc(1));
    await expect(Module.create(moduleDoc(1))).rejects.toMatchObject({ code: DUPLICATE_KEY });
  });

  it('rejects duplicate (userId, moduleId) progress', async () => {
    const row = { userId: new Types.ObjectId(), moduleId: new Types.ObjectId() };
    await UserProgress.create(row);
    await expect(UserProgress.create(row)).rejects.toMatchObject({ code: DUPLICATE_KEY });
  });

  it('rejects a second quiz for the same module', async () => {
    const moduleId = new Types.ObjectId();
    await Quiz.create({ title: 'Q1', moduleId, questions: [question()] });
    await expect(
      Quiz.create({ title: 'Q1 again', moduleId, questions: [question()] }),
    ).rejects.toMatchObject({ code: DUPLICATE_KEY });
  });

  it('allows quizzes for different modules', async () => {
    await Quiz.create({ title: 'A', moduleId: new Types.ObjectId(), questions: [question()] });
    await Quiz.create({ title: 'B', moduleId: new Types.ObjectId(), questions: [question()] });
    expect(await Quiz.countDocuments()).toBe(2);
  });

  it('rejects a second final test', async () => {
    await FinalTest.create({ title: 'Final', questions: [question()] });
    await expect(
      FinalTest.create({ title: 'Final 2', questions: [question()] }),
    ).rejects.toMatchObject({ code: DUPLICATE_KEY });
  });

  it('rejects a second risk profile for the same user', async () => {
    const userId = new Types.ObjectId();
    await RiskProfile.create({ userId });
    await expect(RiskProfile.create({ userId })).rejects.toMatchObject({ code: DUPLICATE_KEY });
  });

  it('rejects a second badge for the same module', async () => {
    const moduleId = new Types.ObjectId();
    await Badge.create({ name: 'Phish Spotter', moduleId, iconMotif: 'hook' });
    await expect(
      Badge.create({ name: 'Other', moduleId, iconMotif: 'shield' }),
    ).rejects.toMatchObject({ code: DUPLICATE_KEY });
  });
});

describe('validation', () => {
  it('rejects an assessment with zero questions', async () => {
    await expect(
      Quiz.create({ title: 'Empty', moduleId: new Types.ObjectId(), questions: [] }),
    ).rejects.toThrow(/at least one question/);
  });

  it.each([-1, 2, 0.5, 'a'])('rejects an out-of-range correctAnswer index (%s)', async (bad) => {
    await expect(FinalTest.create({ title: 'F', questions: [question(bad)] })).rejects.toThrow();
  });

  it('rejects a question with fewer than two options', async () => {
    await expect(
      FinalTest.create({
        title: 'F',
        questions: [{ text: 'q', options: ['only'], correctAnswer: 0 }],
      }),
    ).rejects.toThrow(/at least 2 options/);
  });

  it('rejects unknown fields (strict: throw)', async () => {
    // Bypass the compile-time check on purpose: this simulates untyped input reaching the model.
    const untyped: object = { ...moduleDoc(3), unexpected: true };
    await expect(Module.create(untyped as Parameters<typeof Module.create>[0])).rejects.toThrow(
      /not in schema/,
    );
  });

  it('rejects a non-integer module order', async () => {
    await expect(Module.create(moduleDoc(1.5))).rejects.toThrow(/integer/);
  });

  it('applies Employee defaults from the UML', async () => {
    const e = await Employee.create(employee('defaults@example.com'));
    expect(e.role).toBe('employee');
    expect(e.totalXP).toBe(0);
    expect(e.level).toBe('Apprentice');
    expect(e.isActive).toBe(true);
  });

  it('defaults the assessment passing score to 70', async () => {
    const f = await FinalTest.create({ title: 'F', questions: [question()] });
    expect(f.passingScore).toBe(70);
  });
});

describe('secrets are hidden by default', () => {
  it('does not select passwordHash, and never serialises it', async () => {
    const created = await Employee.create(employee('secret@example.com'));
    expect(JSON.stringify(created.toJSON())).not.toContain('not-a-real-hash');

    const found = await User.findById(created._id).lean();
    expect(found).not.toHaveProperty('passwordHash');
  });

  it('does not select question answer keys', async () => {
    const created = await FinalTest.create({ title: 'F', questions: [question(1)] });
    const found = await Assessment.findById(created._id).lean();
    expect(found?.questions[0]).toBeDefined();
    expect(found?.questions[0]).not.toHaveProperty('correctAnswer');
  });
});
