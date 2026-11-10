import { describe, expect, it } from 'vitest';
import { LOG_MAX_BYTES, REDACTED, createFileLogger, redact } from './log';
import { FakeFs } from './testing/fakes';

describe('LOG1: redaction', () => {
  it('redacts every sensitive key, at any depth and in any case', () => {
    const out = redact({
      Authorization: 'Bearer abc',
      accessToken: 'a',
      refreshToken: 'r',
      password: 'p',
      answers: [{ questionId: 'x', selectedIndex: 1 }],
      selectedIndex: 2,
      optionIndex: 3,
      blob: 'AAAA',
      nested: { deep: { password: 'p2', ok: 'visible' } },
      list: [{ refreshToken: 'r2' }],
    }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toMatch(/"(a|r|p|p2|r2|AAAA)"/);
    for (const k of [
      'Authorization',
      'accessToken',
      'refreshToken',
      'password',
      'answers',
      'selectedIndex',
      'optionIndex',
      'blob',
    ]) {
      expect(out[k]).toBe(REDACTED);
    }
    expect((out.nested as { deep: { ok: string } }).deep.ok).toBe('visible');
    expect(
      ((out.list as { refreshToken: string }[])[0] as { refreshToken: string }).refreshToken,
    ).toBe(REDACTED);
  });

  it('scrubs bearer headers and JWT-shaped strings that slip into free text', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepart';
    const out = redact({ message: `failed with Bearer ${jwt} for user`, other: jwt }) as {
      message: string;
      other: string;
    };
    expect(out.message).not.toContain('eyJ');
    expect(out.other).toBe(REDACTED);
  });

  it('keeps an Error to name and (scrubbed) message only, never a stack', () => {
    const out = redact(new Error('boom')) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(['message', 'name']);
  });

  it('bounds recursion depth', () => {
    const deep: Record<string, unknown> = {};
    let cur = deep;
    for (let i = 0; i < 20; i++) {
      const next: Record<string, unknown> = {};
      cur.n = next;
      cur = next;
    }
    expect(() => redact(deep)).not.toThrow();
  });
});

describe('file logger', () => {
  it('writes JSON lines with redacted data and rotates at 1 MB', async () => {
    const fs = new FakeFs();
    const log = createFileLogger({ fs, dir: '/logs', now: () => new Date('2026-11-10T10:00:00Z') });
    log.info('login', { password: 'hunter2', user: 'u1' });
    await new Promise((r) => setTimeout(r, 10));
    const text = fs.text('/logs/main.log') ?? '';
    expect(text).not.toContain('hunter2');
    const line = JSON.parse(text.trim()) as { event: string; data: { user: string } };
    expect(line.event).toBe('login');
    expect(line.data.user).toBe('u1');

    fs.files.set('/logs/main.log', Buffer.alloc(LOG_MAX_BYTES + 1, 'x'));
    log.warn('after-rotation');
    await new Promise((r) => setTimeout(r, 10));
    expect(fs.files.has('/logs/main.log.1')).toBe(true);
    expect(fs.text('/logs/main.log')).toContain('after-rotation');
  });
});
