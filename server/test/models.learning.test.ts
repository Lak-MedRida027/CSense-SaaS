import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  Assessment,
  AssessmentSession,
  FinalTest,
  Module,
  Quiz,
  QuizAttempt,
  QuizAttemptImmutableError,
} from '../src/models/index.js';

const DUPLICATE_KEY = 11000;

beforeAll(async () => {
  await Promise.all(
    [Module, Assessment, QuizAttempt, AssessmentSession].map((m) => m.syncIndexes()),
  );
});

const exercise = () => ({
  prompt: 'Is this a phishing email?',
  options: ['Yes', 'No'],
  correctAnswer: 0,
  explanation: 'Look at the sender domain.',
});

const question = () => ({
  text: 'Which is a sign of phishing?',
  options: ['Urgent tone', 'Known sender', 'Personal greeting'],
  correctAnswer: 0,
  explanation: 'Pressure is a manipulation tactic.',
});

const moduleDoc = (order: number, extra: object = {}) => ({
  order,
  title: `Module ${String(order)}`,
  description: 'desc',
  format: 'interactive' as const,
  duration: 8,
  exercises: [exercise()],
  ...extra,
});

const attemptDoc = (extra: object = {}) => ({
  userId: new Types.ObjectId(),
  type: 'Quiz' as const,
  refId: new Types.ObjectId(),
  answers: [{ questionId: new Types.ObjectId(), selectedIndex: null, correct: false }],
  score: 0,
  passed: false,
  sessionId: new Types.ObjectId(),
  moduleId: new Types.ObjectId(),
  attemptNumber: 1,
  endReason: 'abandoned' as const,
  correctCount: 0,
  totalCount: 1,
  passingScore: 70,
  ...extra,
});

const sessionDoc = (extra: object = {}) => ({
  userId: new Types.ObjectId(),
  kind: 'FinalTest' as const,
  assessmentId: new Types.ObjectId(),
  passingScore: 70,
  expiresAt: new Date(Date.now() + 60_000),
  questions: [{ questionId: new Types.ObjectId(), optionCount: 4, correctAnswer: 2 }],
  ...extra,
});

describe('answer keys are hidden by default', () => {
  it('ML1: Module and Quiz reads omit keys and explanations unless selected with +', async () => {
    const mod = await Module.create(moduleDoc(1));
    await Quiz.create({ title: 'Q', moduleId: mod._id, questions: [question()] });
    await FinalTest.create({ title: 'F', questions: [question()] });

    const plainModule = await Module.findById(mod._id).lean();
    expect(plainModule?.exercises[0]).toBeDefined();
    expect(plainModule?.exercises[0]).not.toHaveProperty('correctAnswer');
    expect(plainModule?.exercises[0]).not.toHaveProperty('explanation');
    const hydrated = await Module.findById(mod._id);
    expect(JSON.stringify(hydrated?.toObject())).not.toMatch(/correctAnswer|Look at the sender/);
    expect(JSON.stringify(hydrated?.toJSON())).not.toMatch(/correctAnswer|Look at the sender/);

    for (const model of [Quiz, FinalTest, Assessment] as unknown as (typeof Assessment)[]) {
      const lean = await model.findOne().lean();
      expect(lean?.questions[0]).toBeDefined();
      expect(lean?.questions[0]).not.toHaveProperty('correctAnswer');
      expect(lean?.questions[0]).not.toHaveProperty('explanation');
      const doc = await model.findOne();
      expect(JSON.stringify(doc?.toObject())).not.toMatch(
        /correctAnswer|Pressure is a manipulation/,
      );
    }

    const keyed = await Module.findById(mod._id)
      .select('+exercises.correctAnswer +exercises.explanation')
      .lean();
    expect(keyed?.exercises[0]).toMatchObject({
      correctAnswer: 0,
      explanation: 'Look at the sender domain.',
    });
    const keyedQuiz = await Quiz.findOne({})
      .select('+questions.correctAnswer +questions.explanation')
      .lean();
    expect(keyedQuiz?.questions[0]).toMatchObject({
      correctAnswer: 0,
      explanation: 'Pressure is a manipulation tactic.',
    });
  });

  it('rejects out-of-range keys, too many options and over-long text', async () => {
    await expect(
      Module.create(moduleDoc(1, { exercises: [{ ...exercise(), correctAnswer: 2 }] })),
    ).rejects.toThrow(/index into options/);
    await expect(
      FinalTest.create({
        title: 'F',
        questions: [{ ...question(), options: ['1', '2', '3', '4', '5', '6', '7'] }],
      }),
    ).rejects.toThrow(/at most 6/);
    await expect(
      FinalTest.create({ title: 'F', questions: [{ ...question(), text: 'x'.repeat(1001) }] }),
    ).rejects.toThrow();
    await expect(
      Module.create(moduleDoc(2, { exercises: Array.from({ length: 21 }, exercise) })),
    ).rejects.toThrow(/at most 20/);
  });
});

describe('module publish invariant', () => {
  it('ML2: a published video module needs a videoUrl; a published interactive one needs an exercise', async () => {
    await expect(
      Module.create(moduleDoc(1, { format: 'video', exercises: [], isPublished: true })),
    ).rejects.toThrow(/videoUrl/);
    await expect(
      Module.create(moduleDoc(2, { format: 'interactive', exercises: [], isPublished: true })),
    ).rejects.toThrow(/at least one exercise/);

    // Drafts are free; complete modules publish.
    await Module.create(moduleDoc(3, { format: 'video', exercises: [], isPublished: false }));
    await Module.create(
      moduleDoc(4, {
        format: 'video',
        exercises: [],
        isPublished: true,
        videoUrl: 'https://media.example.com/a.mp4',
      }),
    );
    await Module.create(moduleDoc(5, { isPublished: true }));
    // Publishing an existing draft re-runs the check.
    const draft = await Module.findOne({ order: 3 });
    if (!draft) throw new Error('fixture');
    draft.isPublished = true;
    await expect(draft.save()).rejects.toThrow(/videoUrl/);
  });
});

describe('QuizAttempt is append-only', () => {
  it('ML3: create works; every update, replace and delete path throws', async () => {
    const created = await QuizAttempt.create(attemptDoc());
    expect(await QuizAttempt.countDocuments({})).toBe(1);

    const blocked: [string, () => unknown][] = [
      ['updateOne', () => QuizAttempt.updateOne({ _id: created._id }, { score: 100 })],
      ['updateMany', () => QuizAttempt.updateMany({}, { passed: true })],
      [
        'findOneAndUpdate',
        () => QuizAttempt.findOneAndUpdate({ _id: created._id }, { score: 100 }),
      ],
      ['replaceOne', () => QuizAttempt.replaceOne({ _id: created._id }, attemptDoc())],
      [
        'findOneAndReplace',
        () => QuizAttempt.findOneAndReplace({ _id: created._id }, attemptDoc()),
      ],
      ['deleteOne', () => QuizAttempt.deleteOne({ _id: created._id })],
      ['deleteMany', () => QuizAttempt.deleteMany({})],
      ['findOneAndDelete', () => QuizAttempt.findOneAndDelete({ _id: created._id })],
      ['bulkWrite', () => QuizAttempt.bulkWrite([{ deleteOne: { filter: { _id: created._id } } }])],
      [
        'doc.save',
        () => {
          created.score = 100;
          return created.save();
        },
      ],
      ['doc.deleteOne', () => created.deleteOne()],
      ['doc.updateOne', () => created.updateOne({ score: 100 })],
    ];
    for (const [name, run] of blocked) {
      await expect(Promise.resolve().then(run), name).rejects.toBeInstanceOf(
        QuizAttemptImmutableError,
      );
    }
    const stored = await QuizAttempt.findById(created._id).lean();
    expect(stored).toMatchObject({ score: 0, passed: false });
    expect(await QuizAttempt.countDocuments({})).toBe(1);
  });

  it('allows several attempts, but only one per session', async () => {
    const sessionId = new Types.ObjectId();
    await QuizAttempt.create(attemptDoc({ sessionId }));
    await expect(QuizAttempt.create(attemptDoc({ sessionId }))).rejects.toMatchObject({
      code: DUPLICATE_KEY,
    });
    await QuizAttempt.create(attemptDoc());
    expect(await QuizAttempt.countDocuments({})).toBe(2);
  });

  it('validates the new attempt fields', async () => {
    await expect(QuizAttempt.create(attemptDoc({ endReason: 'cheated' }))).rejects.toThrow();
    await expect(QuizAttempt.create(attemptDoc({ attemptNumber: 0 }))).rejects.toThrow();
    await expect(QuizAttempt.create(attemptDoc({ totalCount: 0 }))).rejects.toThrow();
    await expect(QuizAttempt.create(attemptDoc({ sessionId: undefined }))).rejects.toThrow();
  });

  it('has the history indexes', async () => {
    const keys = (await QuizAttempt.collection.indexes()).map((i) => Object.keys(i.key).join(','));
    expect(keys).toEqual(
      expect.arrayContaining([
        'sessionId',
        'userId,attemptedAt,_id',
        'userId,refId,passed',
        'userId,refId,attemptedAt',
      ]),
    );
  });
});

describe('AssessmentSession', () => {
  it('ML4: the partial unique index allows one open session but any number of closed ones', async () => {
    const base = sessionDoc();
    await AssessmentSession.create(base);
    await expect(AssessmentSession.create(sessionDoc(base))).rejects.toMatchObject({
      code: DUPLICATE_KEY,
    });
    await AssessmentSession.create(sessionDoc({ ...base, status: 'abandoned' }));
    await AssessmentSession.create(sessionDoc({ ...base, status: 'expired' }));
    // A different employee or assessment is independent.
    await AssessmentSession.create(sessionDoc({ ...base, userId: new Types.ObjectId() }));
    await AssessmentSession.create(sessionDoc({ ...base, assessmentId: new Types.ObjectId() }));
    expect(await AssessmentSession.countDocuments({})).toBe(5);

    const indexes = await AssessmentSession.collection.indexes();
    const open = indexes.find((i) => i.name === 'one_open_session');
    expect(open).toMatchObject({
      unique: true,
      key: { userId: 1, assessmentId: 1 },
      partialFilterExpression: { status: 'open' },
    });
    const ttl = indexes.find((i) => i.key.expiresAt === 1);
    expect(ttl?.expireAfterSeconds).toBe(30 * 24 * 60 * 60);
  });

  it('ML5: toJSON never emits the served questions or their keys', async () => {
    const created = await AssessmentSession.create(sessionDoc());
    const json = JSON.stringify(created.toJSON());
    expect(json).not.toContain('questions');
    expect(json).not.toContain('correctAnswer');
    const stored = await AssessmentSession.findById(created._id).lean();
    expect(stored?.questions[0]).not.toHaveProperty('correctAnswer');
    const withKey = await AssessmentSession.findById(created._id)
      .select('+questions.correctAnswer')
      .lean();
    expect(withKey?.questions[0]?.correctAnswer).toBe(2);
  });

  it('validates its fields', async () => {
    await expect(AssessmentSession.create(sessionDoc({ status: 'weird' }))).rejects.toThrow();
    await expect(AssessmentSession.create(sessionDoc({ questions: [] }))).rejects.toThrow();
    await expect(
      AssessmentSession.create(
        sessionDoc({
          questions: [{ questionId: new Types.ObjectId(), optionCount: 1, correctAnswer: 0 }],
        }),
      ),
    ).rejects.toThrow();
    await expect(AssessmentSession.create(sessionDoc({ kind: 'Quiz' }))).rejects.toThrow(
      /moduleId/,
    );
  });
});
