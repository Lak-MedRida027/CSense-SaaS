import { Types } from 'mongoose';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureLearningIndexes, missingLearningIndexes } from '../src/db/learningIndexes.js';
import {
  Employee,
  GateAnswer,
  GateAnswerImmutableError,
  GateQuestion,
  GateRun,
  ReconcileMarker,
} from '../src/models/index.js';
import { buildTestApp } from './helpers/fixtures.js';

const DUPLICATE_KEY = 11000;

const run = (userId = new Types.ObjectId(), over: Record<string, unknown> = {}) => ({
  userId,
  maxAttempts: 3,
  openedAt: new Date(),
  ...over,
});

const answer = (runId: Types.ObjectId, attemptIndex: number) => ({
  userId: new Types.ObjectId(),
  runId,
  attemptIndex,
  challengeId: new Types.ObjectId(),
  questionId: new Types.ObjectId(),
  selectedIndex: 1,
  correct: false,
  answeredAt: new Date(),
});

beforeAll(async () => {
  await Promise.all(
    [GateQuestion, GateRun, GateAnswer, ReconcileMarker].map((m) => m.syncIndexes()),
  );
});

describe('gate models', () => {
  it('GM1: the required gate indexes are built and verified', async () => {
    expect(await missingLearningIndexes()).toEqual([]);
  });

  it('GM1b: readiness fails (503) when a gate unique index is missing, and recovers after it is rebuilt', async () => {
    const t = await buildTestApp();
    expect((await request(t.app).get('/api/v1/health/ready')).status).toBe(200);
    await GateRun.collection.dropIndex('one_open_run');
    await GateAnswer.collection.dropIndex('run_attempt_unique');
    try {
      expect((await missingLearningIndexes()).sort()).toEqual(
        ['gateanswers.run_attempt_unique', 'gateruns.one_open_run'].sort(),
      );
      t.advance(31_000);
      const down = await request(t.app).get('/api/v1/health/ready');
      expect(down.status).toBe(503);
      expect(down.body).toEqual({ status: 'unavailable' });
    } finally {
      await ensureLearningIndexes();
    }
    expect(await missingLearningIndexes()).toEqual([]);
  });

  it('GM2: at most one open run per employee, but any number of closed ones', async () => {
    const userId = new Types.ObjectId();
    await GateRun.create(run(userId));
    await expect(GateRun.create(run(userId))).rejects.toMatchObject({ code: DUPLICATE_KEY });
    await GateRun.create(run(new Types.ObjectId())); // another employee is unaffected
    await GateRun.updateOne({ userId }, { $set: { status: 'passed', closedAt: new Date() } });
    await GateRun.create(run(userId));
    await GateRun.create(run(new Types.ObjectId(), { status: 'restricted' }));
    await GateRun.create(run(new Types.ObjectId(), { status: 'restricted' }));
  });

  it('GM3: one recorded answer per run attempt', async () => {
    const runId = new Types.ObjectId();
    await GateAnswer.create(answer(runId, 1));
    await expect(GateAnswer.create(answer(runId, 1))).rejects.toMatchObject({
      code: DUPLICATE_KEY,
    });
    await GateAnswer.create(answer(runId, 2));
  });

  it('GM4: gate answers are append-only', async () => {
    const created = await GateAnswer.create(answer(new Types.ObjectId(), 1));
    await expect(
      GateAnswer.updateOne({ _id: created._id }, { $set: { correct: true } }),
    ).rejects.toBeInstanceOf(GateAnswerImmutableError);
    await expect(GateAnswer.deleteMany({})).rejects.toBeInstanceOf(GateAnswerImmutableError);
    created.correct = true;
    await expect(created.save()).rejects.toBeInstanceOf(GateAnswerImmutableError);
  });

  it('GM5: a run never serialises its key snapshot and does not select it by default', async () => {
    const created = await GateRun.create(
      run(undefined, {
        current: {
          challengeId: new Types.ObjectId(),
          questionId: new Types.ObjectId(),
          prompt: 'Q?',
          options: ['a', 'b', 'c'],
          optionCount: 3,
          correctAnswer: 2,
          servedAt: new Date(),
        },
      }),
    );
    expect(JSON.stringify(created.toJSON())).not.toContain('correctAnswer');
    const plain = await GateRun.findById(created._id).lean();
    expect(plain?.current).not.toHaveProperty('correctAnswer');
    const withKey = await GateRun.findById(created._id).select('+current.correctAnswer').lean();
    expect(withKey?.current?.correctAnswer).toBe(2);
  });

  it('GM6: run bounds are enforced (attempts 1..10, unknown fields and states refused)', async () => {
    await expect(GateRun.create(run(undefined, { maxAttempts: 0 }))).rejects.toThrow();
    await expect(GateRun.create(run(undefined, { maxAttempts: 11 }))).rejects.toThrow();
    await expect(GateRun.create(run(undefined, { passed: true }))).rejects.toThrow();
    await expect(GateRun.create(run(undefined, { status: 'granted' }))).rejects.toThrow();
  });

  it('GM7: a question needs 3 to 6 options, a key inside them and an explanation; key and explanation are not selected by default', async () => {
    const base = {
      prompt: 'Q?',
      options: ['a', 'b', 'c'],
      correctAnswer: 1,
      explanation: 'Because.',
    };
    await expect(GateQuestion.create({ ...base, options: ['a', 'b'] })).rejects.toThrow();
    await expect(
      GateQuestion.create({ ...base, options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }),
    ).rejects.toThrow();
    await expect(GateQuestion.create({ ...base, correctAnswer: 3 })).rejects.toThrow();
    await expect(GateQuestion.create({ ...base, correctAnswer: 0.5 })).rejects.toThrow();
    await expect(GateQuestion.create({ ...base, explanation: '' })).rejects.toThrow();
    await expect(GateQuestion.create({ ...base, extra: 1 } as never)).rejects.toThrow();
    const ok = await GateQuestion.create(base);
    const plain = await GateQuestion.findById(ok._id).lean();
    expect(plain).not.toHaveProperty('correctAnswer');
    expect(plain).not.toHaveProperty('explanation');
    expect(plain?.isActive).toBe(true);
  });

  it('GM8: Employee.gateRestriction defaults to null and holds a run reference', async () => {
    const created = await Employee.create({
      name: 'E',
      email: 'gate.model@example.com',
      passwordHash: 'x',
      createdBy: new Types.ObjectId(),
    });
    expect((await Employee.findById(created._id).lean())?.gateRestriction).toBeNull();
    await Employee.updateOne(
      { _id: created._id },
      { $set: { gateRestriction: { restrictedAt: new Date(), runId: new Types.ObjectId() } } },
    );
    expect((await Employee.findById(created._id).lean())?.gateRestriction?.runId).toBeInstanceOf(
      Types.ObjectId,
    );
  });

  it('GM9: the reconcile marker accepts the gate reason', async () => {
    const doc = await ReconcileMarker.create({ userId: new Types.ObjectId(), reasons: ['gate'] });
    expect(doc.reasons).toEqual(['gate']);
  });
});
