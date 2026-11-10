import { describe, expect, it } from 'vitest';
import {
  checkAuthoringSet,
  checkExplanationEchoes,
  checkLengthRanks,
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

  it('makes sources/source, routes/route and reporting/report collide', () => {
    expect(contentTokens('sources')).toEqual(contentTokens('source'));
    expect(contentTokens('routes')).toEqual(contentTokens('route'));
    expect(contentTokens('reporting')).toEqual(contentTokens('report'));
  });
});

describe('explanation echoes (rule 1)', () => {
  it('passes an explanation that teaches without repeating the answer', () => {
    expect(checkExplanationEchoes([item()])).toEqual([]);
  });

  it('flags a single distinctive word shared with the correct option', () => {
    const found = checkExplanationEchoes([
      item({ explanation: 'A passphrase is hard to guess, whatever the service.' }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ rule: 'explanation_echoes_answer', where: 'q.0' });
    expect(found[0]?.detail).toMatch(/passphras/);
  });

  it('flags an explanation repeating several distinctive words', () => {
    const found = checkExplanationEchoes([
      item({ explanation: 'A unique passphrase is long, so guessing it takes far longer.' }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.detail).toMatch(/unique/);
  });

  it('matches sources with source and routes with route', () => {
    const sources = checkExplanationEchoes([
      item({
        options: [
          'Any site',
          'A forum post',
          'The sources your organisation maintains',
          'An advert',
        ],
        correctAnswer: 2,
        explanation: 'A managed source is checked and kept current.',
      }),
    ]);
    expect(sources).toHaveLength(1);
    const routes = checkExplanationEchoes([
      item({
        options: ['Reply', 'Ignore', 'Check through another route', 'Click'],
        correctAnswer: 2,
        explanation: 'A different route cannot be controlled by the mailbox owner.',
      }),
    ]);
    expect(routes).toHaveLength(1);
  });

  it('ignores stopwords and words that also appear in a distractor', () => {
    const ok = checkExplanationEchoes([
      item({
        options: [
          'Share the secret',
          'Keep the secret private',
          'Post the secret',
          'Hide the secret',
        ],
        correctAnswer: 1,
        explanation: 'Whatever happens, the secret stays where it belongs.',
      }),
    ]);
    expect(ok).toEqual([]);
    const shared = checkExplanationEchoes([
      item({
        options: [
          'Reuse the same password',
          'Share the password',
          'Choose a long password',
          'Skip',
        ],
        correctAnswer: 2,
        explanation: 'A password should be long; every password counts.',
      }),
    ]);
    // "long" is distinctive and appears in the explanation; "password" is in every option.
    expect(shared.map((f) => f.detail)).toEqual([
      'explanation repeats long from the correct option',
    ]);
  });
});

describe('length ranks (rule 2)', () => {
  const TEXTS = [
    'alpha beta gamma delta epsilon',
    'alpha beta gamma delta',
    'alpha beta gamma',
    'alpha beta',
  ];
  /** Four options of strictly decreasing length; the correct one sits at the given length rank. */
  const ranked = (i: number, rank: number): AuthoringItem => {
    const options = [...TEXTS];
    [options[0], options[rank]] = [options[rank] as string, options[0] as string];
    return item({ where: `q.${String(i)}`, options, correctAnswer: 0 });
  };
  const withRank = (n: number, rank: number): AuthoringItem[] =>
    Array.from({ length: n }, (_, i) => ranked(i, rank));

  it('flags an assessment where the correct option is always the longest', () => {
    const found = checkLengthRanks(withRank(8, 0));
    expect(found.every((f) => f.rule === 'length_rank_biased')).toBe(true);
    expect(found.some((f) => f.detail.includes('#1 by characters'))).toBe(true);
    expect(found.some((f) => f.detail.includes('#1 by words'))).toBe(true);
  });

  it('flags every other rank too, so "pick the second longest" does not pay either', () => {
    for (const rank of [1, 2, 3]) {
      const found = checkLengthRanks(withRank(8, rank));
      expect(
        found.some((f) => f.detail.includes(`#${String(rank + 1)} by characters`)),
        String(rank),
      ).toBe(true);
    }
  });

  it('passes when the key is spread evenly over the ranks', () => {
    const even = Array.from({ length: 12 }, (_, i) => ranked(i, i % 4));
    expect(checkLengthRanks(even)).toEqual([]);
  });

  it('judges words as well as characters', () => {
    // Every option is 15 characters long, but the correct one always has the most words.
    const items = Array.from({ length: 8 }, (_, i) =>
      item({
        where: `w.${String(i)}`,
        options: ['a b c d e f g h i', 'abcdefghi jklmn', 'abcdefghijklmno', 'abcdefghijklmnp'],
        correctAnswer: 0,
      }),
    );
    expect(checkLengthRanks(items).some((f) => f.detail.includes('by words'))).toBe(true);
  });

  it('shares credit between tied options, and ignores groups under five items', () => {
    const tied = Array.from({ length: 8 }, (_, i) =>
      item({
        where: `t.${String(i)}`,
        options: ['aaaa', 'bbbb', 'cccc', 'dddd'],
        correctAnswer: 0,
      }),
    );
    expect(checkLengthRanks(tied)).toEqual([]);
    expect(checkLengthRanks(withRank(4, 0))).toEqual([]);
  });

  it('judges each group and the whole set', () => {
    const a = withRank(6, 0).map((x) => ({ ...x, group: 'a' }));
    const b = withRank(6, 3).map((x, i) => ({ ...x, where: `b.${String(i)}`, group: 'b' }));
    const found = checkLengthRanks([...a, ...b]);
    expect(found.map((f) => f.where)).toEqual(expect.arrayContaining(['a', 'b']));
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
    const found = checkNearDuplicates([a, b]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ rule: 'near_duplicate', where: 'final.3' });
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
  it('combines the item rules', () => {
    expect(checkAuthoringSet([item()])).toEqual([]);
    const bad = item({ explanation: 'A unique long passphrase wins.' });
    expect(checkAuthoringSet([bad]).map((f) => f.rule)).toEqual(['explanation_echoes_answer']);
  });
});

describe('pool size (rule 4)', () => {
  it('flags a pool smaller than four times the questions served per session', () => {
    const found = checkPoolSizes([
      { name: 'quiz1', poolSize: 19, questionsPerSession: 5 },
      { name: 'quiz2', poolSize: 20, questionsPerSession: 5 },
      { name: 'quiz3', poolSize: 10, questionsPerSession: 5 },
      { name: 'final', poolSize: 59, questionsPerSession: 15 },
      { name: 'final2', poolSize: 60, questionsPerSession: 15 },
    ]);
    expect(found.map((f) => [f.rule, f.where])).toEqual([
      ['pool_too_small', 'quiz1'],
      ['pool_too_small', 'quiz3'],
      ['pool_too_small', 'final'],
    ]);
    expect(found[0]?.detail).toMatch(/pool of 19/);
  });

  it('accepts a custom factor', () => {
    expect(checkPoolSizes([{ name: 'a', poolSize: 9, questionsPerSession: 5 }], 1)).toEqual([]);
  });
});
