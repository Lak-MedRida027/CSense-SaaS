import { describe, expect, it } from 'vitest';
import {
  computeScore,
  gradeAttempt,
  isPass,
  validateAnswers,
  type ServedQuestion,
  type SubmittedAnswer,
} from './grading.js';

const served = (n: number, optionCount = 4): ServedQuestion[] =>
  Array.from({ length: n }, (_, i) => ({
    questionId: `q${String(i)}`,
    optionCount,
    correctAnswer: i % optionCount,
  }));

/** Answers where the first `correct` questions are right and the rest are wrong. */
const answers = (s: ServedQuestion[], correct: number): SubmittedAnswer[] =>
  s.map((q, i) => ({
    questionId: q.questionId,
    selectedIndex: i < correct ? q.correctAnswer : (q.correctAnswer + 1) % q.optionCount,
  }));

describe('gradeAttempt', () => {
  it('GR1: 5 questions at the default 70 threshold', () => {
    const s = served(5);
    expect(gradeAttempt(s, answers(s, 5), 70)).toMatchObject({ score: 100, passed: true });
    expect(gradeAttempt(s, answers(s, 4), 70)).toMatchObject({ score: 80, passed: true });
    expect(gradeAttempt(s, answers(s, 3), 70)).toMatchObject({ score: 60, passed: false });
    expect(gradeAttempt(s, answers(s, 3), 60)).toMatchObject({ score: 60, passed: true });
  });

  it('GR2: 15 questions and flooring', () => {
    const s = served(15);
    expect(gradeAttempt(s, answers(s, 11), 70)).toMatchObject({ score: 73, passed: true });
    expect(gradeAttempt(s, answers(s, 10), 70)).toMatchObject({ score: 66, passed: false });
    const three = served(3);
    expect(gradeAttempt(three, answers(three, 2), 70).score).toBe(66);
  });

  it('GR3: threshold 0 always passes and 100 needs every answer correct', () => {
    const s = served(5);
    expect(gradeAttempt(s, answers(s, 0), 0).passed).toBe(true);
    expect(gradeAttempt(s, answers(s, 4), 100).passed).toBe(false);
    expect(gradeAttempt(s, answers(s, 5), 100).passed).toBe(true);
  });

  it('GR4: passed iff 100*c >= T*t, and score is an integer in [0, 100]', () => {
    for (let t = 1; t <= 20; t += 1) {
      for (let c = 0; c <= t; c += 1) {
        const score = computeScore(c, t);
        expect(Number.isInteger(score)).toBe(true);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
        for (let threshold = 0; threshold <= 100; threshold += 1) {
          expect(isPass(score, threshold)).toBe(100 * c >= threshold * t);
        }
      }
    }
  });

  it('GR5: unanswered counts wrong, totals use the served count, output is in served order', () => {
    const s = served(4);
    const partial: SubmittedAnswer[] = [
      { questionId: 'q3', selectedIndex: s[3]?.correctAnswer ?? 0 },
      { questionId: 'q1', selectedIndex: null },
    ];
    const graded = gradeAttempt(s, partial, 70);
    expect(graded.totalCount).toBe(4);
    expect(graded.correctCount).toBe(1);
    expect(graded.answers.map((a) => a.questionId)).toEqual(['q0', 'q1', 'q2', 'q3']);
    expect(graded.answers.map((a) => a.selectedIndex)).toEqual([
      null,
      null,
      null,
      s[3]?.correctAnswer,
    ]);
    expect(graded.answers.map((a) => a.correct)).toEqual([false, false, false, true]);
  });

  it('GR5b: the first answer for a question wins and unserved ids are ignored', () => {
    const s = served(2);
    const graded = gradeAttempt(
      s,
      [
        { questionId: 'q0', selectedIndex: 3 },
        { questionId: 'q0', selectedIndex: s[0]?.correctAnswer ?? 0 },
        { questionId: 'zzz', selectedIndex: 0 },
      ],
      70,
    );
    expect(graded.answers).toHaveLength(2);
    expect(graded.answers[0]).toMatchObject({ selectedIndex: 3, correct: false });
  });

  it('GR6: validateAnswers flags unserved, duplicate and out-of-range answers with their index', () => {
    const s = served(3, 4);
    const issues = validateAnswers(s, [
      { questionId: 'q0', selectedIndex: 0 },
      { questionId: 'nope', selectedIndex: 0 },
      { questionId: 'q0', selectedIndex: 1 },
      { questionId: 'q1', selectedIndex: 4 },
      { questionId: 'q2', selectedIndex: -1 },
      { questionId: 'q2', selectedIndex: null },
    ]);
    expect(issues).toEqual([
      { index: 1, field: 'questionId', reason: 'not_served' },
      { index: 2, field: 'questionId', reason: 'duplicate' },
      { index: 3, field: 'selectedIndex', reason: 'out_of_range' },
      { index: 4, field: 'selectedIndex', reason: 'out_of_range' },
      { index: 5, field: 'questionId', reason: 'duplicate' },
    ]);
    expect(validateAnswers(s, [])).toEqual([]);
    expect(validateAnswers(s, [{ questionId: 'q0', selectedIndex: 1.5 }])).toHaveLength(1);
  });

  it('GR6b: the option count is per question', () => {
    const mixed: ServedQuestion[] = [
      { questionId: 'a', optionCount: 2, correctAnswer: 0 },
      { questionId: 'b', optionCount: 6, correctAnswer: 5 },
    ];
    expect(
      validateAnswers(mixed, [
        { questionId: 'a', selectedIndex: 2 },
        { questionId: 'b', selectedIndex: 5 },
      ]),
    ).toEqual([{ index: 0, field: 'selectedIndex', reason: 'out_of_range' }]);
  });

  it('GR7: an empty served set throws', () => {
    expect(() => gradeAttempt([], [], 70)).toThrow();
    expect(() => computeScore(0, 0)).toThrow();
    expect(() => computeScore(3, 2)).toThrow();
  });
});
