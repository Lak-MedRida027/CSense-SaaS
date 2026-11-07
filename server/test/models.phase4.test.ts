import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  Badge,
  BadgeAward,
  Escalation,
  ReconcileMarker,
  RiskAssessment,
  RiskProfile,
} from '../src/models/index.js';
import { missingLearningIndexes } from '../src/db/learningIndexes.js';

const DUPLICATE_KEY = 11000;

beforeAll(async () => {
  await Promise.all(
    [BadgeAward, RiskAssessment, Escalation, RiskProfile, ReconcileMarker].map((m) =>
      m.syncIndexes(),
    ),
  );
});

const award = (userId: Types.ObjectId, badgeId: Types.ObjectId) => ({
  userId,
  badgeId,
  moduleId: new Types.ObjectId(),
  attemptId: null,
  source: 'completion' as const,
  awardedAt: new Date(),
});

const rejectsImmutable = async (op: () => unknown): Promise<void> => {
  await expect(Promise.resolve().then(op)).rejects.toMatchObject({
    code: expect.stringMatching(/_IMMUTABLE$/) as unknown,
  });
};

const mk = (doc: Record<string, unknown>) => Escalation.create(doc as never);

const escalationDoc = (
  userId: Types.ObjectId,
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  userId,
  reason: 'risk_level_high',
  severity: 'elevated',
  reviewTier: 'security_team',
  scopeKey: 'risk',
  dedupeKey: `risk_level_high:${userId.toHexString()}:${new Types.ObjectId().toHexString()}`,
  context: {},
  sourceRef: { type: 'risk_assessment', id: new Types.ObjectId() },
  openedAt: new Date(),
  events: [],
  ...over,
});

describe('Phase 4 models', () => {
  it('MP1: BadgeAward rejects a duplicate (user, badge) and every mutation path', async () => {
    const userId = new Types.ObjectId();
    const badgeId = new Types.ObjectId();
    const doc = await BadgeAward.create(award(userId, badgeId));
    await expect(BadgeAward.create(award(userId, badgeId))).rejects.toMatchObject({
      code: DUPLICATE_KEY,
    });
    // Another employee may earn the same badge.
    await BadgeAward.create(award(new Types.ObjectId(), badgeId));

    await rejectsImmutable(() => BadgeAward.updateOne({ _id: doc._id }, { source: 'reconcile' }));
    await rejectsImmutable(() => BadgeAward.deleteOne({ _id: doc._id }));
    await rejectsImmutable(() => BadgeAward.deleteMany({}));
    await rejectsImmutable(() =>
      BadgeAward.findOneAndUpdate({ _id: doc._id }, { source: 'reconcile' }),
    );
    await rejectsImmutable(() => BadgeAward.replaceOne({ _id: doc._id }, award(userId, badgeId)));
    await rejectsImmutable(async () => {
      const loaded = await BadgeAward.findById(doc._id);
      if (!loaded) throw new Error('missing');
      loaded.source = 'reconcile';
      await loaded.save();
    });
    expect(await BadgeAward.countDocuments()).toBe(2);
  });

  it('MP2: RiskAssessment is append-only', async () => {
    const userId = new Types.ObjectId();
    const cov = {
      knowledge: 'assessed',
      behavioural: 'assessed',
      simulation: 'disabled',
      engagement: 'assessed',
    };
    const w = { knowledge: 4286, behavioural: 3571, simulation: 0, engagement: 2143 };
    const ev = {
      attempts: 1,
      firstAttempts: 1,
      abandoned: 0,
      expired: 0,
      extraFailures: 0,
      cooldowns: 0,
      passedModules: 0,
      curriculumSize: 8,
      finalTestPassed: false,
      simulationOutcomes: 0,
    };
    const doc = await RiskAssessment.create({
      userId,
      profileRev: 1,
      modelVersion: 1,
      scores: { knowledge: 10, behavioural: 0, simulation: null, engagement: 100 },
      compositeScore: 40,
      riskLevel: 'Medium',
      previousLevel: null,
      levelChanged: true,
      coverage: cov,
      effectiveWeightsBp: w,
      evidence: ev,
      inputsDigest: 'a'.repeat(64),
      trigger: { type: 'attempt', refId: new Types.ObjectId() },
      computedAt: new Date(),
    });
    await rejectsImmutable(() =>
      RiskAssessment.updateOne({ _id: doc._id }, { levelChanged: false }),
    );
    await rejectsImmutable(() => RiskAssessment.deleteOne({ _id: doc._id }));
    await rejectsImmutable(() => RiskAssessment.deleteMany({}));
    await expect(
      RiskAssessment.create({ userId, profileRev: 2, modelVersion: 1, levelChanged: false }),
    ).rejects.toThrow();
    expect(await RiskAssessment.countDocuments()).toBe(1);
  });

  it('MP3: one active risk escalation per user; a resolved one allows a new one; dedupeKey is unique', async () => {
    const userId = new Types.ObjectId();
    const first = await mk(escalationDoc(userId));
    await expect(mk(escalationDoc(userId))).rejects.toMatchObject({ code: DUPLICATE_KEY });

    // Another employee is independent; a different scope (assessment) is independent too.
    await mk(escalationDoc(new Types.ObjectId()));
    await mk(
      escalationDoc(userId, {
        reason: 'repeated_assessment_cooldowns',
        scopeKey: `assessment:${new Types.ObjectId().toHexString()}`,
      }),
    );

    await Escalation.updateOne({ _id: first._id }, { $set: { active: false, status: 'resolved' } });
    await mk(escalationDoc(userId));

    const dupKey = escalationDoc(new Types.ObjectId(), { dedupeKey: 'same-key' });
    await mk(dupKey);
    await expect(
      mk({ ...dupKey, userId: new Types.ObjectId(), scopeKey: null }),
    ).rejects.toMatchObject({ code: DUPLICATE_KEY });
  });

  it('MP3b: critical escalations (no scope key) are not limited to one per user', async () => {
    const userId = new Types.ObjectId();
    for (const n of [1, 2]) {
      await mk(
        escalationDoc(userId, {
          reason: 'gate_access_restricted',
          scopeKey: null,
          dedupeKey: `k${String(n)}`,
        }),
      );
    }
    expect(await Escalation.countDocuments({ userId })).toBe(2);
  });

  it('MP4: RiskProfile defaults to null (not assessed) and rejects out-of-range and fractional scores', async () => {
    const profile = await RiskProfile.create({ userId: new Types.ObjectId() });
    expect(profile.knowledgeScore).toBeNull();
    expect(profile.behaviouralScore).toBeNull();
    expect(profile.simulationScore).toBeNull();
    expect(profile.engagementScore).toBeNull();
    expect(profile.compositeScore).toBeNull();
    expect(profile.riskLevel).toBeNull();
    expect(profile.rev).toBe(0);
    for (const bad of [101, -1, 1.5]) {
      await expect(
        RiskProfile.create({ userId: new Types.ObjectId(), knowledgeScore: bad }),
      ).rejects.toThrow();
    }
    await expect(
      RiskProfile.create({ userId: new Types.ObjectId(), riskLevel: 'Severe' } as never),
    ).rejects.toThrow();
  });

  it('Badge: the motif is bounded and the unique index set is complete', async () => {
    await expect(
      Badge.create({ name: 'x', moduleId: new Types.ObjectId(), iconMotif: 'y'.repeat(41) }),
    ).rejects.toThrow();
    expect(await missingLearningIndexes()).toEqual([]);
  });

  it('ReconcileMarker: one marker per user', async () => {
    const userId = new Types.ObjectId();
    await ReconcileMarker.create({ userId, reasons: ['risk'] });
    await expect(ReconcileMarker.create({ userId })).rejects.toMatchObject({ code: DUPLICATE_KEY });
  });
});
