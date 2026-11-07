import { describe, expect, it } from 'vitest';
import {
  checkAuthoringSet,
  checkExplanationEchoes,
  checkLongestOption,
  checkNearDuplicates,
  checkPoolSizes,
  contentTokens,
  type AuthoringItem,
} from './authoringCheck.js';

const item = (over: Partial<AuthoringItem> = {}): AuthoringItem => ({
  where: 'q.0',
  group: 'g',
  text: 'Which habit protects an account best?',
  options: ['Reusing one password', 'Writing it down', 'A unique long passphrase', 'Sharing it'],
  correctAnswer: 2,
  explanation: 'Attackers try leaked credentials everywhere, so each service needs its own secret.',
  ...over,
});

describe('contentTokens', () => {
  it('drops short words and stopwords, and stems plurals', () => {
    expect([...contentTokens('The reports were sent to Security teams')].sort()).toEqual([
      'report',
      'security',
      'sent',
      'team',
    ]);
  });
});

describe('explanation echoes (rule 1)', () => {
  it('passes an explanation that teaches without repeating the answer', () => {
    expect(checkExplanationEchoes([item()])).toEqual([]);
  });

  it('flags an explanation repeating two distinctive words of the correct option', () => {
    const flagged = checkExplanationEchoes([
      item({ explanation: 'A unique passphrase is long, so guessing it takes far longer.' }),
    ]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ rule: 'explanation_echoes_answer', where: 'q.0' });
    expect(flagged[0]?.detail).toMatch(/unique/);
  });

  it('ignores words that the distractors share with the correct option', () => {
    const shared = item({
      options: ['Reuse the same password', 'Share the password', 'Choose a long password', 'Skip'],
      correctAnswer: 2,
      explanation: 'A password should be long; every password counts.',
    });
    expect(checkExplanationEchoes([shared])).toEqual([]);
  });

  it('matches plural and singular forms', () => {
    const flagged = checkExplanationEchoes([
      item({
        options: ['Ignore it', 'Forward it', 'Reporting suspicious messages', 'Delete it'],
        correctAnswer: 2,
        explanation: 'A suspicious message should be handled by those who report them.',
      }),
    ]);
    expect(flagged).toHaveLength(1);
  });
});

describe('longest correct option (rule 2)', () => {
  const longest = (n: number): AuthoringItem[] =>
    Array.from({ length: n }, (_, i) =>
      item({
        where: `q.${String(i)}`,
        options: ['short a', 'short b', 'a deliberately much longer correct option', 'short d'],
        correctAnswer: 2,
      }),
    );

  it('flags an assessment where the correct option is always the longest', () => {
    const f = checkLongestOption(longest(5));
    expect(f.map((x) => x.rule)).toContain('longest_option_correct');
    expect(f[0]?.where).toBe('g');
  });

  it('passes when the key is spread over the lengths', () => {
    const spread = longest(5).map((x, i) =>
      i < 5
        ? {
            ...x,
            options: x.options.map((o, k) =>
              k === (i + 1) % 4 ? 'a deliberately much longer option' : o,
            ),
            correctAnswer: i % 4,
          }
        : x,
    );
    expect(checkLongestOption(spread)).toEqual([]);
  });

  it('ignores tiny groups', () => {
    expect(checkLongestOption(longest(2))).toEqual([]);
  });
});

describe('near duplicates (rule 3)', () => {
  it('flags a question copied into another group', () => {
    const a = item({
      where: 'quiz1.0',
      group: 'quiz1',
      text: 'Which password is the strongest choice for work?',
    });
    const b = item({
      where: 'final.3',
      group: 'final',
      text: 'Which password is the strongest choice for work today?',
    });
    const f = checkNearDuplicates([a, b]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ rule: 'near_duplicate', where: 'final.3' });
  });

  it('passes unrelated questions', () => {
    const a = item({
      where: 'a',
      group: 'x',
      text: 'What does a padlock in the address bar confirm?',
    });
    const b = item({
      where: 'b',
      group: 'y',
      text: 'Who may receive your sign-in approval code?',
      options: ['Nobody at all', 'Any colleague', 'The help desk', 'A manager'],
      correctAnswer: 0,
    });
    expect(checkNearDuplicates([a, b])).toEqual([]);
  });

  it('flags a repeated correct option across groups even when the questions differ', () => {
    const answer = [
      'Report it to the security team promptly',
      'Ignore it',
      'Delete it',
      'Forward it',
    ];
    const a = item({
      where: 'a',
      group: 'x',
      text: 'Something odd happened on your laptop today?',
      options: answer,
      correctAnswer: 0,
    });
    const b = item({
      where: 'b',
      group: 'y',
      text: 'A strange invoice arrived by messenger yesterday?',
      options: answer,
      correctAnswer: 0,
    });
    expect(checkNearDuplicates([a, b]).map((x) => x.detail)).toEqual([
      'correct option repeats the correct option of a',
    ]);
  });
});

describe('checkAuthoringSet', () => {
  it('combines the three rules', () => {
    expect(checkAuthoringSet([item()])).toEqual([]);
    const bad = item({ explanation: 'A unique long passphrase wins.' });
    expect(checkAuthoringSet([bad]).map((f) => f.rule)).toEqual(['explanation_echoes_answer']);
  });
});

describe('pool size (rule 4)', () => {
  it('flags a pool smaller than twice the questions served per session', () => {
    const found = checkPoolSizes([
      { name: 'quiz1', poolSize: 9, questionsPerSession: 5 },
      { name: 'quiz2', poolSize: 10, questionsPerSession: 5 },
      { name: 'final', poolSize: 29, questionsPerSession: 15 },
      { name: 'final2', poolSize: 30, questionsPerSession: 15 },
    ]);
    expect(found.map((f) => [f.rule, f.where])).toEqual([
      ['pool_too_small', 'quiz1'],
      ['pool_too_small', 'final'],
    ]);
    expect(found[0]?.detail).toMatch(/pool of 9/);
  });

  it('accepts a custom factor', () => {
    expect(checkPoolSizes([{ name: 'a', poolSize: 9, questionsPerSession: 5 }], 1)).toEqual([]);
  });
});
