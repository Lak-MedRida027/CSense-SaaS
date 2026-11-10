/**
 * Strict zod input schemas for every bridge v1 channel (main only; the preload never loads zod).
 * One schema per channel in `IPC_CHANNELS_V1`: `assertIpcRegistry` fails start-up if any is missing.
 */
import { MAX_OPTIONS, objectIdSchema } from '@csense/shared';
import { z } from 'zod';
import { IPC_CHANNELS_V1, IPC_PREFIX, type IpcArea } from './ipcChannels';

export * from './ipcChannels';

/** The password crosses IPC once, at login. Same 72 UTF-8 byte bound as the shared policy. */
const PASSWORD_MAX_BYTES = 72;
const id = objectIdSchema.transform((v) => v.toLowerCase());
const optionIndex = z
  .number()
  .int()
  .min(0)
  .max(MAX_OPTIONS - 1);

/** At most 50 answers per submission (plan 4.4); the server enforces its own, larger bound. */
export const IPC_MAX_ANSWERS = 50;

const noInput = z.undefined();

export const IPC_INPUT_SCHEMAS = {
  'session.getState': noInput,
  'session.login': z
    .object({
      email: z.string().min(1).max(254),
      password: z
        .string()
        .min(1)
        .refine((v) => new TextEncoder().encode(v).length <= PASSWORD_MAX_BYTES, {
          message: `password must be at most ${String(PASSWORD_MAX_BYTES)} bytes`,
        }),
    })
    .strict(),
  'session.logout': noInput,

  'gate.getView': noInput,
  'gate.requestChallenge': noInput,
  'gate.submitAnswer': z.object({ challengeId: id, optionIndex }).strict(),
  'gate.continue': noInput,
  'gate.continueOffline': noInput,

  'assessment.startSecure': z.union([
    z.object({ kind: z.literal('quiz'), moduleId: id }).strict(),
    z.object({ kind: z.literal('final') }).strict(),
  ]),
  'assessment.resume': noInput,
  'assessment.submit': z
    .object({
      sessionId: id,
      answers: z
        .array(z.object({ questionId: id, selectedIndex: optionIndex.nullable() }).strict())
        .max(IPC_MAX_ANSWERS)
        .refine((a) => new Set(a.map((x) => x.questionId)).size === a.length, {
          message: 'duplicate questionId',
        }),
    })
    .strict(),
  'assessment.exit': z.object({ sessionId: id }).strict(),

  'learning.getOverview': noInput,
  'learning.getQuizOverview': z.object({ moduleId: id }).strict(),
} as const;

export type IpcMethodKey = keyof typeof IPC_INPUT_SCHEMAS;

/** `area.method` keys implied by the channel table, for registry assertions. */
export function declaredMethodKeys(): string[] {
  return (Object.keys(IPC_CHANNELS_V1) as IpcArea[]).flatMap((area) =>
    IPC_CHANNELS_V1[area].map((m) => `${area}.${m}`),
  );
}

export function channelFor(key: string): string {
  return `${IPC_PREFIX}${key}`;
}
