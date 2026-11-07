import { describe, expect, it } from 'vitest';
import { createUserRequestSchema } from './users.js';
import { loginRequestSchema, refreshRequestSchema } from './auth.js';
import { emailSchema, newPasswordSchema, objectIdSchema } from './common.js';

const validUser = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  password: 'correct horse battery',
  role: 'employee',
};

describe('shared request schemas', () => {
  it('trims and lowercases emails', () => {
    expect(emailSchema.parse('  Jane.Doe@Example.COM ')).toBe('jane.doe@example.com');
    expect(loginRequestSchema.parse({ email: ' A@B.co ', password: 'x' }).email).toBe('a@b.co');
  });

  it('rejects malformed and over-long emails', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
    expect(emailSchema.safeParse(`${'a'.repeat(250)}@b.co`).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.co', password: 'x', extra: 1 }).success).toBe(
      false,
    );
    expect(createUserRequestSchema.safeParse({ ...validUser, isActive: true }).success).toBe(false);
    expect(refreshRequestSchema.safeParse({ refreshToken: 'a', x: 1 }).success).toBe(false);
  });

  it('enforces the password policy in characters and in UTF-8 bytes', () => {
    expect(newPasswordSchema.safeParse('x'.repeat(11)).success).toBe(false);
    expect(newPasswordSchema.safeParse('x'.repeat(12)).success).toBe(true);
    expect(newPasswordSchema.safeParse('x'.repeat(72)).success).toBe(true);
    expect(newPasswordSchema.safeParse('x'.repeat(73)).success).toBe(false);
    // 40 characters but 80 bytes.
    const multibyte = '\u00e9'.repeat(40);
    expect(multibyte.length).toBeLessThan(72);
    expect(newPasswordSchema.safeParse(multibyte).success).toBe(false);
  });

  it('accepts login passwords of 1..1024 characters only', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
    expect(
      loginRequestSchema.safeParse({ email: 'a@b.co', password: 'x'.repeat(1024) }).success,
    ).toBe(true);
    expect(
      loginRequestSchema.safeParse({ email: 'a@b.co', password: 'x'.repeat(1025) }).success,
    ).toBe(false);
  });

  it('rejects operator objects in place of strings', () => {
    expect(loginRequestSchema.safeParse({ email: { $ne: null }, password: 'x' }).success).toBe(
      false,
    );
    expect(loginRequestSchema.safeParse({ email: 'a@b.co', password: { $gt: '' } }).success).toBe(
      false,
    );
  });

  it('enforces the role enum and rejects __proto__ payloads', () => {
    expect(createUserRequestSchema.safeParse(validUser).success).toBe(true);
    expect(createUserRequestSchema.safeParse({ ...validUser, role: 'superadmin' }).success).toBe(
      false,
    );
    const polluted: unknown = JSON.parse(
      '{"name":"a","email":"a@b.co","password":"correct horse battery","role":"employee","__proto__":{"role":"administrator"}}',
    );
    expect(createUserRequestSchema.safeParse(polluted).success).toBe(false);
  });

  it('validates object ids', () => {
    expect(objectIdSchema.safeParse('a'.repeat(24)).success).toBe(true);
    expect(objectIdSchema.safeParse('zz').success).toBe(false);
  });
});
