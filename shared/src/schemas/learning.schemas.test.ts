import { describe, expect, it } from 'vitest';
import {
  assessmentSessionSchema,
  assessmentAuthoringSchema,
  attemptParamsSchema,
  listAttemptsQuerySchema,
  moduleAuthoringSchema,
  questionAuthoringSchema,
  reviewItemSchema,
  submitAttemptRequestSchema,
} from '../index.js';

const hex = (c: string): string => c.repeat(24);
const valid = () => ({
  sessionId: hex('a'),
  answers: [
    { questionId: hex('b'), selectedIndex: 2 },
    { questionId: hex('c'), selectedIndex: null },
  ],
});

describe('submitAttemptRequestSchema', () => {
  it('accepts a well-formed submission, with null for unanswered (SC2)', () => {
    expect(submitAttemptRequestSchema.safeParse(valid()).success).toBe(true);
  });

  it.each([
    ['score', { score: 100 }],
    ['passed', { passed: true }],
    ['correct', { correct: true }],
    ['userId', { userId: hex('d') }],
  ])('SC1: rejects a forged %s at the top level', (_name, extra) => {
    expect(submitAttemptRequestSchema.safeParse({ ...valid(), ...extra }).success).toBe(false);
  });

  it('SC1: rejects forged fields inside an answer', () => {
    const body = valid();
    expect(
      submitAttemptRequestSchema.safeParse({
        ...body,
        answers: [{ questionId: hex('b'), selectedIndex: 1, correct: true }],
      }).success,
    ).toBe(false);
  });

  it('SC1: rejects an own __proto__ key from JSON', () => {
    const parsed: unknown = JSON.parse(
      `{"sessionId":"${hex('a')}","answers":[],"__proto__":{"passed":true}}`,
    );
    expect(submitAttemptRequestSchema.safeParse(parsed).success).toBe(false);
  });

  it('SC1: rejects more than 100 answers', () => {
    const answers = Array.from({ length: 101 }, (_, i) => ({
      questionId: i.toString(16).padStart(24, '0'),
      selectedIndex: 0,
    }));
    expect(submitAttemptRequestSchema.safeParse({ sessionId: hex('a'), answers }).success).toBe(
      false,
    );
  });

  it('SC1: rejects duplicate questionIds, also across letter case', () => {
    const dup = {
      sessionId: hex('a'),
      answers: [
        { questionId: hex('b'), selectedIndex: 0 },
        { questionId: hex('B'), selectedIndex: 1 },
      ],
    };
    expect(submitAttemptRequestSchema.safeParse(dup).success).toBe(false);
  });

  it.each([-1, 1.5, 6, 100, '1', Number.NaN])('SC1: rejects selectedIndex %s', (bad) => {
    const body = { sessionId: hex('a'), answers: [{ questionId: hex('b'), selectedIndex: bad }] };
    expect(submitAttemptRequestSchema.safeParse(body).success).toBe(false);
  });

  it('normalises ids to lower case', () => {
    const parsed = submitAttemptRequestSchema.parse({ sessionId: hex('A'), answers: [] });
    expect(parsed.sessionId).toBe(hex('a'));
  });

  it('rejects malformed ids', () => {
    expect(submitAttemptRequestSchema.safeParse({ sessionId: 'x', answers: [] }).success).toBe(
      false,
    );
    expect(attemptParamsSchema.safeParse({ attemptId: { $ne: 'x' } }).success).toBe(false);
  });
});

describe('listAttemptsQuerySchema', () => {
  it('SC3: coerces limit, defaults it, and rejects 0, 101 and unknown keys', () => {
    expect(listAttemptsQuerySchema.parse({}).limit).toBe(20);
    expect(listAttemptsQuerySchema.parse({ limit: '5' }).limit).toBe(5);
    expect(listAttemptsQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(listAttemptsQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(listAttemptsQuerySchema.safeParse({ extra: '1' }).success).toBe(false);
    expect(listAttemptsQuerySchema.safeParse({ kind: 'Other' }).success).toBe(false);
  });
});

describe('response schemas', () => {
  it('SC4: reject an extra correctAnswer on a served question', () => {
    const session = {
      sessionId: hex('a'),
      kind: 'Quiz',
      assessmentId: hex('b'),
      moduleId: hex('c'),
      title: 'Quiz',
      passingScore: 70,
      attemptNumber: 1,
      startedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      questions: [{ questionId: hex('d'), text: 'q', options: ['a', 'b'] }],
    };
    expect(assessmentSessionSchema.safeParse(session).success).toBe(true);
    const leaky = {
      ...session,
      questions: [{ questionId: hex('d'), text: 'q', options: ['a', 'b'], correctAnswer: 1 }],
    };
    expect(assessmentSessionSchema.safeParse(leaky).success).toBe(false);
    expect(
      assessmentSessionSchema.safeParse({
        ...session,
        questions: [{ questionId: hex('d'), text: 'q', options: ['a', 'b'], explanation: 'x' }],
      }).success,
    ).toBe(false);
  });

  it('review items allow the optional reveal fields but nothing else', () => {
    const base = {
      questionId: hex('a'),
      text: 't',
      options: [],
      selectedIndex: null,
      correct: false,
    };
    expect(reviewItemSchema.safeParse(base).success).toBe(true);
    expect(reviewItemSchema.safeParse({ ...base, correctIndex: 1, explanation: 'e' }).success).toBe(
      true,
    );
    expect(reviewItemSchema.safeParse({ ...base, correctAnswer: 1 }).success).toBe(false);
  });
});

describe('authoring schemas', () => {
  const base = {
    order: 1,
    title: 'T',
    description: 'D',
    format: 'video' as const,
    duration: 5,
    isPublished: true,
    videoUrl: 'https://media.example.com/a.mp4',
  };

  it('SC5: accepts a minimal published video module', () => {
    expect(moduleAuthoringSchema.safeParse(base).success).toBe(true);
  });

  it('SC5: rejects a published video module without videoUrl', () => {
    const { videoUrl: _omit, ...noVideo } = base;
    expect(moduleAuthoringSchema.safeParse(noVideo).success).toBe(false);
    expect(moduleAuthoringSchema.safeParse({ ...noVideo, isPublished: false }).success).toBe(true);
  });

  it('SC5: rejects a published interactive module without exercises', () => {
    const interactive = { ...base, format: 'interactive' as const };
    expect(moduleAuthoringSchema.safeParse(interactive).success).toBe(false);
    expect(
      moduleAuthoringSchema.safeParse({
        ...interactive,
        exercises: [{ prompt: 'p', options: ['a', 'b'], correctAnswer: 1, explanation: 'e' }],
      }).success,
    ).toBe(true);
  });

  it('SC5: rejects http and non-URL media links', () => {
    expect(
      moduleAuthoringSchema.safeParse({ ...base, videoUrl: 'http://media.example.com/a.mp4' })
        .success,
    ).toBe(false);
    expect(moduleAuthoringSchema.safeParse({ ...base, videoUrl: 'not a url' }).success).toBe(false);
    expect(
      moduleAuthoringSchema.safeParse({ ...base, captionsUrl: 'javascript:alert(1)' }).success,
    ).toBe(false);
  });

  it('SC5: rejects a key out of range and an empty explanation', () => {
    const q = { text: 'q', options: ['a', 'b'], correctAnswer: 1, explanation: 'why' };
    expect(questionAuthoringSchema.safeParse(q).success).toBe(true);
    expect(questionAuthoringSchema.safeParse({ ...q, correctAnswer: 2 }).success).toBe(false);
    expect(questionAuthoringSchema.safeParse({ ...q, correctAnswer: -1 }).success).toBe(false);
    expect(questionAuthoringSchema.safeParse({ ...q, explanation: '' }).success).toBe(false);
    expect(questionAuthoringSchema.safeParse({ ...q, explanation: '   ' }).success).toBe(false);
    expect(questionAuthoringSchema.safeParse({ ...q, options: ['only'] }).success).toBe(false);
  });
});

describe('assessment authoring pool invariant (P3-M1)', () => {
  const question = (i: number) => ({
    text: `Question ${String(i)}`,
    options: ['a', 'b'],
    correctAnswer: 0,
    explanation: 'Because.',
  });
  const assessment = (pool: number, perSession: number) => ({
    title: 'Quiz',
    questionsPerSession: perSession,
    questions: Array.from({ length: pool }, (_, i) => question(i)),
  });

  it('requires a pool of at least four times the questions served per session', () => {
    expect(assessmentAuthoringSchema.safeParse(assessment(20, 5)).success).toBe(true);
    expect(assessmentAuthoringSchema.safeParse(assessment(60, 15)).success).toBe(true);
    const small = assessmentAuthoringSchema.safeParse(assessment(19, 5));
    expect(small.success).toBe(false);
    expect(small.error?.issues[0]?.path).toEqual(['questions']);
    expect(assessmentAuthoringSchema.safeParse(assessment(59, 15)).success).toBe(false);
    expect(assessmentAuthoringSchema.safeParse(assessment(10, 5)).success).toBe(false); // the old 2x rule
  });

  it('needs questionsPerSession and rejects zero or fractions', () => {
    const { questionsPerSession: _omit, ...without } = assessment(20, 5);
    expect(assessmentAuthoringSchema.safeParse(without).success).toBe(false);
    expect(assessmentAuthoringSchema.safeParse(assessment(20, 0)).success).toBe(false);
    expect(
      assessmentAuthoringSchema.safeParse({ ...assessment(20, 5), questionsPerSession: 2.5 })
        .success,
    ).toBe(false);
  });
});
