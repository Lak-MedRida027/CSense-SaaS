import { describe, expect, it } from 'vitest';
import { FakeFs, FakeSafeStorage, recordingLogger } from '../testing/fakes';
import { TokenStore, type SessionTokens } from './tokenStore';

const FILE = '/ud/session.v1.json';
const NOW = Date.parse('2026-11-10T10:00:00Z');

const tokens = (over: Partial<SessionTokens> = {}): SessionTokens => ({
  userId: 'u1',
  accessToken: 'ACCESS-SECRET-VALUE',
  accessExpiresAt: NOW + 900_000,
  refreshToken: 'REFRESH-SECRET-VALUE-0123456789',
  refreshExpiresAt: NOW + 7 * 86_400_000,
  ...over,
});

function make() {
  const fs = new FakeFs();
  const safeStorage = new FakeSafeStorage();
  const log = recordingLogger();
  const store = new TokenStore({ fs, safeStorage, filePath: FILE, log, now: () => NOW });
  return { fs, safeStorage, log, store };
}

describe('TokenStore (S7, S8)', () => {
  it('TS1: encrypts, persists and loads back (round trip)', async () => {
    const { fs, safeStorage, log, store } = make();
    await store.set(tokens());
    expect(fs.files.has(FILE)).toBe(true);

    const fresh = new TokenStore({ fs, safeStorage, filePath: FILE, log, now: () => NOW });
    const loaded = await fresh.load();
    expect(loaded).toEqual({
      userId: 'u1',
      refreshToken: 'REFRESH-SECRET-VALUE-0123456789',
      refreshExpiresAt: NOW + 7 * 86_400_000,
    });
    expect(fresh.getAccess()).toBeNull();
  });

  it('TS2: unavailable encryption keeps the session in memory and writes NOTHING', async () => {
    const { fs, safeStorage, store } = make();
    safeStorage.available = false;
    await store.set(tokens());
    expect(fs.ops).toEqual([]);
    expect(fs.files.size).toBe(0);
    expect(store.getRefresh()?.refreshToken).toBe('REFRESH-SECRET-VALUE-0123456789');
    expect(store.persistence).toBe('memory_only');
    expect(await store.load()).toBeNull();
  });

  it('TS3: the Linux basic_text backend is treated as unavailable (and so is "unknown")', async () => {
    for (const backend of ['basic_text', 'unknown']) {
      const { fs, safeStorage, store } = make();
      safeStorage.backend = backend;
      await store.set(tokens());
      expect(fs.ops, backend).toEqual([]);
      expect(store.persistence).toBe('memory_only');
    }
  });

  it('TS4: a corrupt file is deleted and the store starts signed out', async () => {
    for (const garbage of [
      'not json',
      '{"v":2}',
      '{"v":1,"userId":"u","refreshTokenExpiresAt":"x","blob":"!!"}',
    ]) {
      const { fs, store } = make();
      fs.files.set(FILE, Buffer.from(garbage));
      expect(await store.load()).toBeNull();
      expect(fs.files.has(FILE), garbage).toBe(false);
    }
  });

  it('TS4b: an undecryptable blob (another OS user / DPAPI key change) is deleted', async () => {
    const { fs, store } = make();
    fs.files.set(
      FILE,
      Buffer.from(
        JSON.stringify({
          v: 1,
          userId: 'u1',
          refreshTokenExpiresAt: new Date(NOW + 1e9).toISOString(),
          blob: Buffer.from([0xff, 0x01]).toString('base64'),
        }),
      ),
    );
    expect(await store.load()).toBeNull();
    expect(fs.files.has(FILE)).toBe(false);
  });

  it('TS5: an expired file is deleted', async () => {
    const { fs, safeStorage, log, store } = make();
    await store.set(tokens({ refreshExpiresAt: NOW + 1000 }));
    const later = new TokenStore({ fs, safeStorage, filePath: FILE, log, now: () => NOW + 5000 });
    expect(await later.load()).toBeNull();
    expect(fs.files.has(FILE)).toBe(false);
  });

  it('TS6: the file is written atomically (temp file, then rename)', async () => {
    const { fs, store } = make();
    await store.set(tokens());
    expect(fs.ops).toEqual([`write:${FILE}.tmp`, `rename:${FILE}.tmp->${FILE}`]);
    expect(fs.files.has(`${FILE}.tmp`)).toBe(false);
  });

  it('TS7: the persisted file never contains either token in clear (byte scan)', async () => {
    const { fs, store } = make();
    await store.set(tokens());
    const bytes = fs.files.get(FILE) ?? Buffer.alloc(0);
    expect(bytes.includes(Buffer.from('REFRESH-SECRET-VALUE'))).toBe(false);
    expect(bytes.includes(Buffer.from('ACCESS-SECRET-VALUE'))).toBe(false);
    // The access token is never persisted at all.
    expect(bytes.toString('utf8')).not.toMatch(/access/i);
    const parsed = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['blob', 'refreshTokenExpiresAt', 'userId', 'v']);
  });

  it('TS8: clear wipes memory and file', async () => {
    const { fs, store } = make();
    await store.set(tokens());
    await store.clear();
    expect(store.getAccess()).toBeNull();
    expect(store.getRefresh()).toBeNull();
    expect(fs.files.has(FILE)).toBe(false);
  });

  it('keeps working from memory when the disk write fails (no throw, no plaintext fallback)', async () => {
    const { fs, store, log } = make();
    fs.failWrites = true;
    await expect(store.set(tokens())).resolves.toBeUndefined();
    expect(store.getRefresh()).not.toBeNull();
    expect(fs.files.size).toBe(0);
    expect(log.events.some((e) => e.event === 'session.persist_failed')).toBe(true);
  });

  it('rotation overwrites the persisted refresh token', async () => {
    const { fs, safeStorage, log, store } = make();
    await store.set(tokens());
    await store.set(tokens({ refreshToken: 'ROTATED-REFRESH-TOKEN-999999' }));
    const fresh = new TokenStore({ fs, safeStorage, filePath: FILE, log, now: () => NOW });
    expect((await fresh.load())?.refreshToken).toBe('ROTATED-REFRESH-TOKEN-999999');
  });
});
