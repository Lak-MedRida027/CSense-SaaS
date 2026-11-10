import { describe, expect, it } from 'vitest';
import { selectQuestionIds } from '../learning/selection.js';
import {
  gateAttemptRequestSchema,
  gateQuestionAuthoringSchema,
  restoreAccessRequestSchema,
  restoreAccessParamsSchema,
} from './gate.js';
import { gateAttemptResultSchema, gateStatusSchema, restoreAccessSchema } from './gateResponses.js';
import { formatGateReference } from '../gate/reference.js';

const goodQuestion = {
  prompt: 'You receive an unexpected email asking you to confirm your password. What do you do?',
  options: ['Reply with the password', 'Report it to the security team', 'Forward it to a friend'],
  correctAnswer: 1,
  explanation:
    'Real organisations never ask for credentials by email; unexpected requests need a second look.',
};

describe('gate authoring schema', () => {
  it('GQ1: accepts a well formed question', () => {
    expect(gateQuestionAuthoringSchema.safeParse(goodQuestion).success).toBe(true);
  });

  it('GQ1: option count is 3..6', () => {
    const two = { ...goodQuestion, options: ['a one', 'b two'], correctAnswer: 0 };
    expect(gateQuestionAuthoringSchema.safeParse(two).success).toBe(false);
    const seven = {
      ...goodQuestion,
      options: Array.from({ length: 7 }, (_, i) => `option ${String.fromCharCode(97 + i)}`),
    };
    expect(gateQuestionAuthoringSchema.safeParse(seven).success).toBe(false);
  });

  it('GQ1: the key must be an index into options', () => {
    expect(
      gateQuestionAuthoringSchema.safeParse({ ...goodQuestion, correctAnswer: 3 }).success,
    ).toBe(false);
    expect(
      gateQuestionAuthoringSchema.safeParse({ ...goodQuestion, correctAnswer: -1 }).success,
    ).toBe(false);
  });

  it('GQ1: an explanation is required and must not give the answer away', () => {
    const { explanation: _omit, ...without } = goodQuestion;
    expect(gateQuestionAuthoringSchema.safeParse(without).success).toBe(false);
    expect(
      gateQuestionAuthoringSchema.safeParse({ ...goodQuestion, explanation: '  ' }).success,
    ).toBe(false);
    const echo = {
      ...goodQuestion,
      explanation: 'The right move is to report it to the security team.',
    };
    expect(gateQuestionAuthoringSchema.safeParse(echo).success).toBe(false);
    const distinctive = { ...goodQuestion, explanation: 'Reporting protects colleagues too.' };
    expect(gateQuestionAuthoringSchema.safeParse(distinctive).success).toBe(false);
  });

  it('GQ1: plain text only, no links, markup, control characters or unknown fields', () => {
    expect(
      gateQuestionAuthoringSchema.safeParse({ ...goodQuestion, prompt: 'See https://x.example' })
        .success,
    ).toBe(false);
    expect(
      gateQuestionAuthoringSchema.safeParse({ ...goodQuestion, prompt: 'Is <b>this</b> safe?' })
        .success,
    ).toBe(false);
    expect(
      gateQuestionAuthoringSchema.safeParse({ ...goodQuestion, prompt: 'bad\u0000char' }).success,
    ).toBe(false);
    expect(gateQuestionAuthoringSchema.safeParse({ ...goodQuestion, isActive: true }).success).toBe(
      false,
    );
  });

  it('GQ1: duplicate options are refused', () => {
    expect(
      gateQuestionAuthoringSchema.safeParse({
        ...goodQuestion,
        options: ['Same text', 'same text', 'Another'],
        correctAnswer: 2,
      }).success,
    ).toBe(false);
  });
});

const status = {
  state: 'challenge',
  maxAttempts: 3,
  attemptsRemaining: 3,
  challenge: { challengeId: 'a'.repeat(24), prompt: 'Q?', options: ['a', 'b', 'c'] },
  clearedUntil: null,
  restricted: null,
} as const;

describe('gate request and response schemas', () => {
  it('GS1: the attempt request is strict, so no client claim can be made', () => {
    const ok = { challengeId: 'a'.repeat(24), selectedIndex: 1 };
    expect(gateAttemptRequestSchema.safeParse(ok).success).toBe(true);
    for (const extra of [{ correct: true }, { passed: true }, { score: 100 }, { x: 1 }]) {
      expect(gateAttemptRequestSchema.safeParse({ ...ok, ...extra }).success).toBe(false);
    }
  });

  it('GS2: the attempt request bounds the index and the id', () => {
    const id = 'a'.repeat(24);
    for (const selectedIndex of [-1, 1.5, 6, '1', null]) {
      expect(gateAttemptRequestSchema.safeParse({ challengeId: id, selectedIndex }).success).toBe(
        false,
      );
    }
    expect(
      gateAttemptRequestSchema.safeParse({ challengeId: 'nope', selectedIndex: 0 }).success,
    ).toBe(false);
    expect(gateAttemptRequestSchema.safeParse({ challengeId: id }).success).toBe(false);
  });

  it('GS3: response schemas are strict and carry no key field', () => {
    expect(gateStatusSchema.safeParse(status).success).toBe(true);
    for (const extra of [{ correctAnswer: 1 }, { correctIndex: 1 }, { isCorrect: true }]) {
      expect(gateStatusSchema.safeParse({ ...status, ...extra }).success).toBe(false);
      expect(
        gateStatusSchema.safeParse({
          ...status,
          challenge: { ...status.challenge, ...extra },
        }).success,
      ).toBe(false);
    }
    const result = { correct: false, explanation: 'Because.', xpEarned: 0, status };
    expect(gateAttemptResultSchema.safeParse(result).success).toBe(true);
    expect(gateAttemptResultSchema.safeParse({ ...result, correctAnswer: 0 }).success).toBe(false);
    expect(
      gateStatusSchema.safeParse({ ...status, challenge: { ...status.challenge, options: ['a'] } })
        .success,
    ).toBe(false);
  });

  it('GS4: the restore request needs a clean note, the response is strict', () => {
    expect(
      restoreAccessRequestSchema.safeParse({ note: 'Checked with the manager.' }).success,
    ).toBe(true);
    for (const note of ['', '   ', 'x'.repeat(2001), 'bad\u0007note', '\ud800']) {
      expect(restoreAccessRequestSchema.safeParse({ note }).success).toBe(false);
    }
    expect(restoreAccessRequestSchema.safeParse({ note: 'ok', extra: 1 }).success).toBe(false);
    expect(restoreAccessParamsSchema.safeParse({ userId: 'x' }).success).toBe(false);
    const dto = { userId: 'u', runId: 'r', escalationId: 'e', restoredAt: 't' };
    expect(restoreAccessSchema.safeParse(dto).success).toBe(true);
    expect(restoreAccessSchema.safeParse({ ...dto, note: 'leak' }).success).toBe(false);
  });
});

describe('gate reference and selection', () => {
  it('formats the reference in the organisation time zone', () => {
    const runId = '0123456789abcdef01234567';
    expect(formatGateReference(runId, '2026-07-01T23:30:00.000Z', 'UTC')).toBe(
      'GATE-20260701-234567',
    );
    expect(formatGateReference(runId, '2026-07-01T23:30:00.000Z', 'Africa/Casablanca')).toBe(
      'GATE-20260702-234567',
    );
  });

  it('SEL1: one question at a time never repeats within a run and prefers the least recently served', () => {
    const pool = ['q1', 'q2', 'q3', 'q4', 'q5'];
    const identity = <T>(items: readonly T[]): T[] => [...items];
    // history: oldest first; q1 served longest ago, q5 never.
    expect(selectQuestionIds(pool, [['q1'], ['q2'], ['q3'], ['q4']], 1, identity)).toEqual(['q5']);
    expect(selectQuestionIds(pool, [['q1'], ['q2'], ['q3'], ['q4'], ['q5']], 1, identity)).toEqual([
      'q1',
    ]);
    // inside a run, every served id is excluded by passing the run's served ids as latest history
    const served: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const [next] = selectQuestionIds(pool, [...served.map((s) => [s])], 1, identity);
      expect(next).toBeDefined();
      expect(served).not.toContain(next);
      served.push(next as string);
    }
  });
});
