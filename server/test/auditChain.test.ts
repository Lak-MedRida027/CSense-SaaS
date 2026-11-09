import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { canonicalEntry, fieldsOf, hmacHex, stableStringify } from '../src/features/audit/chain.js';
import { audit, createAuditService } from '../src/features/audit/audit.service.js';
import { Mutex } from '../src/lib/mutex.js';
import { AuditLog } from '../src/models/index.js';
import { verifyAuditChain as verifyCli, verifyAndRecord } from '../src/scripts/verifyAudit.js';
import { verifyAuditChain } from './helpers/riskFixtures.js';
import { randomSecret, testChainSecret } from './helpers/testConfig.js';

const entry = (over: Record<string, unknown> = {}) => ({
  action: 'auth.logout' as const,
  outcome: 'success' as const,
  ...over,
});

const seqs = async (): Promise<number[]> =>
  (await AuditLog.find({}).sort({ seq: 1 }).select('seq').lean()).map((d) => d.seq ?? 0);

describe('audit hash chain (ADR 0012)', () => {
  it('AC1: three records chain from the genesis hash and verify; the stored createdAt is the hashed one', async () => {
    const results = [
      await audit.record(entry()),
      await audit.record(entry()),
      await audit.record(entry()),
    ];
    expect(results.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(results.every((r) => !r.duplicate)).toBe(true);
    const docs = await AuditLog.find({}).sort({ seq: 1 }).lean();
    expect(docs[0]?.prevHash).toBe('0'.repeat(64));
    expect(docs[1]?.prevHash).toBe(docs[0]?.hash);
    expect(docs[2]?.prevHash).toBe(docs[1]?.hash);
    for (const d of docs) {
      expect(d.hash).toMatch(/^[0-9a-f]{64}$/);
      // The stored timestamp is exactly what was hashed (timestamps must not overwrite it).
      expect(hmacHex(testChainSecret, canonicalEntry(fieldsOf(d)))).toBe(d.hash);
    }
    expect(await verifyAuditChain()).toMatchObject({
      ok: true,
      checked: 3,
      tipSeq: 3,
      firstBreak: null,
    });
  });

  it('AC2: 50 concurrent records get seq 1..50 with no gaps and verify', async () => {
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => audit.record(entry({ metadata: { i } }))),
    );
    expect(await seqs()).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(await verifyAuditChain()).toMatchObject({ ok: true, checked: 50 });
  });

  it('AC3: an edit of metadata through the driver is a hash_mismatch at that seq', async () => {
    for (let i = 0; i < 10; i += 1) await audit.record(entry({ metadata: { i } }));
    await AuditLog.collection.updateOne({ seq: 7 }, { $set: { 'metadata.i': 999 } });
    const report = await verifyAuditChain();
    expect(report.ok).toBe(false);
    expect(report.firstBreak).toEqual({ seq: 7, reason: 'hash_mismatch' });
    expect(report.checked).toBe(6);
  });

  it('AC4: a deleted entry is a gap; swapped links are a link_mismatch', async () => {
    for (let i = 0; i < 12; i += 1) await audit.record(entry({ metadata: { i } }));
    const four = await AuditLog.collection.findOne({ seq: 4 });
    const five = await AuditLog.collection.findOne({ seq: 5 });
    await AuditLog.collection.updateOne({ seq: 4 }, { $set: { prevHash: five?.prevHash } });
    await AuditLog.collection.updateOne({ seq: 5 }, { $set: { prevHash: four?.prevHash } });
    expect(await verifyAuditChain()).toMatchObject({
      ok: false,
      firstBreak: { seq: 4, reason: 'link_mismatch' },
    });
    await AuditLog.collection.updateOne({ seq: 4 }, { $set: { prevHash: four?.prevHash } });
    await AuditLog.collection.updateOne({ seq: 5 }, { $set: { prevHash: five?.prevHash } });
    expect((await verifyAuditChain()).ok).toBe(true);

    await AuditLog.collection.deleteOne({ seq: 10 });
    expect(await verifyAuditChain()).toMatchObject({
      ok: false,
      firstBreak: { seq: 10, reason: 'gap' },
    });
  });

  it('AC4b: swapping two stored hashes is detected', async () => {
    for (let i = 0; i < 6; i += 1) await audit.record(entry({ metadata: { i } }));
    const two = await AuditLog.collection.findOne({ seq: 2 });
    const three = await AuditLog.collection.findOne({ seq: 3 });
    await AuditLog.collection.updateOne({ seq: 2 }, { $set: { hash: three?.hash } });
    await AuditLog.collection.updateOne({ seq: 3 }, { $set: { hash: two?.hash } });
    const report = await verifyAuditChain();
    expect(report.ok).toBe(false);
    expect(report.firstBreak?.seq).toBe(2);
  });

  it('AC5: the same idempotencyKey twice gives one entry, duplicate true, and no seq is consumed', async () => {
    const first = await audit.record(entry({ idempotencyKey: 'once' }));
    const second = await audit.record(entry({ idempotencyKey: 'once' }));
    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ id: first.id, seq: first.seq, duplicate: true });
    const next = await audit.record(entry());
    expect(next.seq).toBe(2);
    expect(await AuditLog.countDocuments()).toBe(2);
  });

  it('AC5b: concurrent writers with one idempotencyKey produce one entry', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => audit.record(entry({ idempotencyKey: 'race' }))),
    );
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(await AuditLog.countDocuments({ idempotencyKey: 'race' })).toBe(1);
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it('AC6: a direct create without chain fields fails; insertMany is blocked', async () => {
    await expect(AuditLog.create({ ...entry(), createdAt: new Date() })).rejects.toThrow(/seq/);
    await expect(
      AuditLog.insertMany([{ ...entry(), createdAt: new Date() }]),
    ).rejects.toMatchObject({ code: 'AUDIT_LOG_IMMUTABLE' });
    expect(await AuditLog.countDocuments()).toBe(0);
  });

  it('AC7: verification with a different secret fails at seq 1', async () => {
    await audit.record(entry());
    await audit.record(entry());
    expect(await verifyAuditChain(randomSecret())).toMatchObject({
      ok: false,
      firstBreak: { seq: 1, reason: 'hash_mismatch' },
    });
  });

  it('AC8: key order and Dates are canonical; recomputing matches', async () => {
    const when = new Date('2026-03-04T05:06:07.000Z');
    await audit.record(entry({ metadata: { b: 1, a: { z: 1, y: [1, { k: 1, j: 2 }] }, when } }));
    const doc = await AuditLog.findOne().lean();
    expect(doc?.metadata).toEqual({
      b: 1,
      a: { z: 1, y: [1, { k: 1, j: 2 }] },
      when: when.toISOString(),
    });
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect((await verifyAuditChain()).ok).toBe(true);
    await expect(audit.record(entry({ metadata: { n: Number.NaN } }))).rejects.toThrow(/finite/);
    await expect(audit.record(entry({ metadata: { f: () => 1 } }))).rejects.toThrow(/JSON/);
  });

  it('AC9: a competing writer with its own mutex interleaves and the chain stays dense and valid', async () => {
    const other = createAuditService({ chainSecret: testChainSecret, mutex: new Mutex() });
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        i % 2 === 0
          ? audit.record(entry({ metadata: { i } }))
          : other.record(entry({ metadata: { i } })),
      ),
    );
    expect(await seqs()).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(await verifyAuditChain()).toMatchObject({ ok: true, checked: 30 });
  });

  it('records the actor, target and request context inside the hash', async () => {
    const actor = new Types.ObjectId();
    const target = new Types.ObjectId();
    await audit.record({
      action: 'user.created',
      outcome: 'success',
      actor: { id: actor, role: 'administrator' },
      target: { type: 'user', id: target },
      ctx: { ip: '203.0.113.9', userAgent: 'ua', requestId: 'rid' },
    });
    await AuditLog.collection.updateOne({ seq: 1 }, { $set: { ip: '198.51.100.1' } });
    expect((await verifyAuditChain()).firstBreak).toEqual({ seq: 1, reason: 'hash_mismatch' });
  });

  it('CLI: audit:verify reports ok, counts legacy entries, and records the result', async () => {
    await audit.record(entry());
    await audit.record(entry());
    await AuditLog.collection.insertOne({
      action: 'auth.logout',
      outcome: 'success',
      severity: 'info',
      metadata: {},
      createdAt: new Date(0), // older than the chain: genuine pre-Phase-4 legacy
    });
    const result = await verifyCli({ secret: testChainSecret });
    expect(result).toMatchObject({
      ok: true,
      checked: 2,
      tipSeq: 2,
      unchainedLegacy: 1,
      unchainedAfterChain: 0,
      nonNumericSeq: 0,
    });

    const recorded = await verifyAndRecord({ secret: testChainSecret });
    expect(recorded.ok).toBe(true);
    const checked = await AuditLog.findOne({ action: 'audit.integrity_checked' }).lean();
    expect(checked?.severity).toBe('info');
    expect(checked?.metadata).toMatchObject({ ok: true, tipSeq: 2, checked: 2 });
    expect(checked?.metadata).toHaveProperty('tipDigest');
    // Verifying from the middle uses the previous hash as the anchor.
    expect((await verifyCli({ secret: testChainSecret, fromSeq: 2 })).ok).toBe(true);

    await AuditLog.collection.updateOne({ seq: 1 }, { $set: { outcome: 'failure' } });
    const broken = await verifyAndRecord({ secret: testChainSecret });
    expect(broken.ok).toBe(false);
    const alarm = await AuditLog.findOne({
      action: 'audit.integrity_checked',
      outcome: 'failure',
    }).lean();
    expect(alarm?.severity).toBe('critical');
    expect(alarm?.metadata).toMatchObject({ firstBreak: { seq: 1, reason: 'hash_mismatch' } });
  });
});
