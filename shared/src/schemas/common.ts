import { z } from 'zod';
import {
  LOGIN_PASSWORD_MAX_LENGTH,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
} from '../constants/auth.js';

/** UTF-8 byte length without relying on TextEncoder/Buffer (shared has no DOM or Node lib). */
const utf8Length = (s: string): number => {
  let bytes = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
};

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/** Policy for passwords being set (D-9): min 12 chars, max 72 UTF-8 bytes, no composition rules. */
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `must be at least ${String(PASSWORD_MIN_LENGTH)} characters`)
  .refine((v) => utf8Length(v) <= PASSWORD_MAX_BYTES, {
    message: `must be at most ${String(PASSWORD_MAX_BYTES)} bytes`,
  });

/** Login accepts anything up to 1024 chars so policy changes never lock people out or leak hints. */
export const loginPasswordSchema = z.string().min(1).max(LOGIN_PASSWORD_MAX_LENGTH);

export const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/i, 'must be a 24-character hex id');
