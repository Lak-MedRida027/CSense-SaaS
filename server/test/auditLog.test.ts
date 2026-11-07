import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { audit, sanitizeMetadata } from '../src/features/audit/audit.service.js';
import { AuditLog } from '../src/models/index.js';

beforeAll(async () => {
  await AuditLog.syncIndexes();
});

const entry = (overrides: Record<string, unknown> = {}) => ({
  action: 'auth.login.succeeded' as const,
  outcome: 'success' as const,
  ...overrides,
});

const rejectsImmutable = async (op: () => unknown): Promise<void> => {
  await expect(Promise.resolve().then(op)).rejects.toMatchObject({ code: 'AUDIT_LOG_IMMUTABLE' });
};

describe('AuditLog model', () => {
  it('AU1: create works, createdAt is set and there is no updatedAt', async () => {
    const doc = await AuditLog.create(entry());
    const raw = await AuditLog.collection.findOne({ _id: doc._id });
    expect(raw?.createdAt).toBeInstanceOf(Date);
    expect(raw).not.toHaveProperty('updatedAt');
    expect(doc.severity).toBe('info');
    expect(doc.metadata).toEqual({});
  });

  it('AU2: every update, replace, delete and bulk path is rejected and nothing changes', async () => {
    const doc = await AuditLog.create(entry({ metadata: { n: 1 } }));
    const id = doc._id;
    const original = JSON.stringify(await AuditLog.collection.findOne({ _id: id }));

    const ops: (() => unknown)[] = [
      () => AuditLog.updateOne({ _id: id }, { outcome: 'failure' }),
      () => AuditLog.updateMany({}, { outcome: 'failure' }),
      () => AuditLog.findOneAndUpdate({ _id: id }, { outcome: 'failure' }),
      () => AuditLog.findByIdAndUpdate(id, { outcome: 'failure' }),
      () => AuditLog.replaceOne({ _id: id }, entry({ outcome: 'failure' })),
      () => AuditLog.findOneAndReplace({ _id: id }, entry({ outcome: 'failure' })),
      () => AuditLog.deleteOne({ _id: id }),
      () => AuditLog.deleteMany({}),
      () => AuditLog.findOneAndDelete({ _id: id }),
      () => AuditLog.findByIdAndDelete(id),
      () =>
        AuditLog.bulkWrite([
          { updateOne: { filter: { _id: id }, update: { outcome: 'failure' } } },
        ]),
      () => AuditLog.bulkWrite([{ deleteOne: { filter: { _id: id } } }]),
      async () => {
        const loaded = await AuditLog.findById(id);
        if (!loaded) throw new Error('missing');
        loaded.outcome = 'failure';
        await loaded.save();
      },
      async () => {
        const loaded = await AuditLog.findById(id);
        if (!loaded) throw new Error('missing');
        await loaded.deleteOne();
      },
      async () => {
        const loaded = await AuditLog.findById(id);
        if (!loaded) throw new Error('missing');
        await loaded.updateOne({ outcome: 'failure' });
      },
    ];
    for (const op of ops) await rejectsImmutable(op);

    expect(await AuditLog.countDocuments()).toBe(1);
    expect(JSON.stringify(await AuditLog.collection.findOne({ _id: id }))).toBe(original);
  });

  it('AU3: insertMany is allowed', async () => {
    const docs = await AuditLog.insertMany([entry(), entry({ action: 'auth.logout' })]);
    expect(docs).toHaveLength(2);
    expect(await AuditLog.countDocuments()).toBe(2);
  });

  it('AU4: unknown fields and unknown actions are rejected', async () => {
    await expect(AuditLog.create(entry({ extra: 'x' }))).rejects.toThrow(/not in schema/);
    await expect(AuditLog.create(entry({ action: 'user.exploded' }))).rejects.toThrow();
    await expect(AuditLog.create(entry({ outcome: 'maybe' }))).rejects.toThrow();
    expect(await AuditLog.countDocuments()).toBe(0);
  });

  it('AU5: the service strips secret-like metadata keys; oversized metadata is rejected', async () => {
    await audit.record({
      action: 'auth.login.failed',
      outcome: 'failure',
      metadata: {
        reason: 'bad_credentials',
        password: 'p',
        refreshToken: 't',
        secretKey: 's',
        currentTokenHash: 'h',
        nested: { accessToken: 'a', keep: 1 },
      },
    });
    const stored = await AuditLog.findOne().lean();
    expect(stored?.metadata).toEqual({ reason: 'bad_credentials', nested: { keep: 1 } });

    await expect(
      audit.record({
        action: 'auth.login.failed',
        outcome: 'failure',
        metadata: { blob: 'x'.repeat(3000) },
      }),
    ).rejects.toThrow(/2 KB/);
    expect(await AuditLog.countDocuments()).toBe(1);
  });

  it('records actor, target and request context', async () => {
    const actor = new Types.ObjectId();
    const target = new Types.ObjectId();
    await audit.record({
      action: 'user.created',
      outcome: 'success',
      severity: 'warning',
      actor: { id: actor, role: 'administrator' },
      target: { type: 'user', id: target.toHexString() },
      ctx: { ip: '203.0.113.9', userAgent: 'ua', requestId: 'rid' },
    });
    const stored = await AuditLog.findOne().lean();
    expect(stored?.actorId?.toString()).toBe(actor.toHexString());
    expect(stored).toMatchObject({
      actorRole: 'administrator',
      targetType: 'user',
      severity: 'warning',
      ip: '203.0.113.9',
      userAgent: 'ua',
      requestId: 'rid',
    });
  });

  it('sanitizeMetadata leaves non-secret values intact', () => {
    expect(sanitizeMetadata({ a: 1, list: [{ token: 'x', ok: true }] })).toEqual({
      a: 1,
      list: [{ ok: true }],
    });
  });
});
