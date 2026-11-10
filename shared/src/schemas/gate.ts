import { z } from 'zod';
import {
  GATE_OFFLINE_DURATION_MAX_SECONDS,
  GATE_OFFLINE_REASONS,
  GATE_OPTION_MAX,
  GATE_OPTION_MIN,
  GATE_RESTORE_NOTE_MAX,
} from '../constants/gate.js';
import { contentTokens } from '../learning/authoringCheck.js';
import { objectIdSchema } from './common.js';
import { isCleanText } from './text.js';

/**
 * Gate request schemas (Phase 5, ADR 0015). All strict: an unknown field such as `correct`,
 * `passed` or `score` is a 400, so a client has no way to claim an outcome.
 */
const id = objectIdSchema.transform((v) => v.toLowerCase());

/** POST /gate/attempts. The server grades against its own key snapshot. */
export const gateAttemptRequestSchema = z
  .object({
    challengeId: id,
    selectedIndex: z
      .number()
      .int()
      .min(0)
      .max(GATE_OPTION_MAX - 1),
  })
  .strict();
export type GateAttemptRequest = z.infer<typeof gateAttemptRequestSchema>;

export const restoreAccessParamsSchema = z.object({ userId: id }).strict();

/** POST /admin/users/:userId/restore-access. */
export const restoreAccessRequestSchema = z
  .object({
    note: z
      .string()
      .trim()
      .min(1)
      .max(GATE_RESTORE_NOTE_MAX)
      .refine(isCleanText, { message: 'contains control characters or invalid characters' }),
  })
  .strict();
export type RestoreAccessRequest = z.infer<typeof restoreAccessRequestSchema>;

/**
 * Gate question authoring (seed now, Phase 7 admin API later): plain text only, 3 to 6 options, a
 * mandatory explanation that must not repeat the correct option's distinctive words (ADR 0007).
 */
const plainText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(isCleanText, { message: 'contains control characters or invalid characters' })
    .refine((v) => !/https?:\/\/|<[a-z/!]/i.test(v), {
      message: 'must be plain text without links or markup',
    });

export const gateQuestionAuthoringSchema = z
  .object({
    prompt: plainText(1000),
    options: z.array(plainText(300)).min(GATE_OPTION_MIN).max(GATE_OPTION_MAX),
    correctAnswer: z.number().int().min(0),
    explanation: plainText(1000),
    topic: plainText(60).optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (q.correctAnswer >= q.options.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['correctAnswer'],
        message: 'correctAnswer must be an index into options',
      });
      return;
    }
    const lower = q.options.map((o) => o.toLowerCase());
    if (new Set(lower).size !== lower.length) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'options must be distinct' });
    }
    const correct = q.options[q.correctAnswer] ?? '';
    if (q.explanation.toLowerCase().includes(correct.toLowerCase())) {
      ctx.addIssue({
        code: 'custom',
        path: ['explanation'],
        message: 'the explanation must not contain the correct option text',
      });
      return;
    }
    // Words only the correct option has must not appear in the explanation (it would give the key away).
    const others = new Set<string>();
    q.options.forEach((o, i) => {
      if (i !== q.correctAnswer) for (const w of contentTokens(o)) others.add(w);
    });
    const explained = contentTokens(q.explanation);
    const echoed = [...contentTokens(correct)].filter((w) => !others.has(w) && explained.has(w));
    if (echoed.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['explanation'],
        message: 'the explanation repeats distinctive words of the correct option',
      });
    }
  });
export type GateQuestionAuthoring = z.infer<typeof gateQuestionAuthoringSchema>;

/**
 * POST /gate/offline-releases: the desktop reports that it released the workstation while the API
 * was unreachable (D5-12). Strict; the server checks the time window.
 */
export const gateOfflineReleaseRequestSchema = z
  .object({
    releasedAt: z.iso.datetime(),
    reason: z.enum(GATE_OFFLINE_REASONS),
    durationSeconds: z.number().int().min(0).max(GATE_OFFLINE_DURATION_MAX_SECONDS).optional(),
  })
  .strict();
export type GateOfflineReleaseRequest = z.infer<typeof gateOfflineReleaseRequestSchema>;
