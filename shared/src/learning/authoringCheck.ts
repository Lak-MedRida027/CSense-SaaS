import { MIN_POOL_FACTOR } from '../constants/learning.js';
/**
 * Content-quality checks for multiple-choice items (Phase 3, reused by Phase 7 content management).
 * The reveal policy (ADR 0007) shows an explanation after a failed attempt, and retries are
 * unlimited, so an item that gives its answer away defeats the quiz. These pure functions flag
 * three authoring mistakes:
 *  1. an explanation that repeats distinctive words of the correct option;
 *  2. an assessment where the correct option's length rank (by characters or by words) beats chance;
 *  3. near-duplicate question text across items (an exercise or module quiz whose answer an
 *     employee has already seen must not reappear elsewhere).
 */
export interface AuthoringItem {
  /** Human-readable location, for example "quiz3.2" or "final.7". */
  where: string;
  /** Items of one assessment (or one module's exercises) share a group. */
  group: string;
  text: string;
  options: readonly string[];
  correctAnswer: number;
  explanation: string;
}

export type AuthoringRule =
  'explanation_echoes_answer' | 'length_rank_biased' | 'near_duplicate' | 'pool_too_small';

export interface AuthoringFinding {
  rule: AuthoringRule;
  where: string;
  detail: string;
}

const STOPWORDS = new Set(
  (
    'about above after again also always another because been before being between both cannot could ' +
    'does doing done down during each either else ever every from have having here into just like ' +
    'make many more most much must never only other over same should since some such than that their ' +
    'them then there these they this those through under until upon very want were what when where ' +
    'which while whom will with within without would your yours you the and are for not but can any ' +
    'all has had how its our out too was who why one two may might'
  ).split(' '),
);

/**
 * A deliberately crude stem: "sources" and "source", "routes" and "route", "reporting" and "report"
 * meet. It only has to make related forms collide; precision is not needed for a warning.
 */
function stem(word: string): string {
  let w = word;
  for (const suffix of ['ing', 'ed', 'es', 's']) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 4) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return w.length > 4 && w.endsWith('e') ? w.slice(0, -1) : w;
}

/** Lower-cased words of 4+ letters, minus stopwords, stemmed so related forms compare equal. */
export function contentTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (raw.length < 4 || STOPWORDS.has(raw)) continue;
    out.add(stem(raw));
  }
  return out;
}

/** Plain 4+ letter words with no filtering: the strictest view of "shared wording". */
const rawWords = (text: string): Set<string> =>
  new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? []);

const jaccard = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
};

/** Rule 1: distinctive words of the correct option (absent from every distractor) in the explanation. */
export function checkExplanationEchoes(
  items: readonly AuthoringItem[],
  options: { minStemShared?: number; minWordShared?: number } = {},
): AuthoringFinding[] {
  // One shared distinctive content word is enough: a failed review shows the explanation, and a
  // single word that appears only in the correct option points straight at it. The plain-word
  // measure (stopwords included) keeps the older, stricter reading of two shared words.
  const minStemShared = options.minStemShared ?? 1;
  const minWordShared = options.minWordShared ?? 2;
  const findings: AuthoringFinding[] = [];
  for (const item of items) {
    const correct = item.options[item.correctAnswer] ?? '';
    const overlap = (toSet: (t: string) => ReadonlySet<string>): string[] => {
      const others = new Set<string>();
      item.options.forEach((o, k) => {
        if (k !== item.correctAnswer) for (const w of toSet(o)) others.add(w);
      });
      const explained = toSet(item.explanation);
      return [...toSet(correct)].filter((w) => !others.has(w) && explained.has(w));
    };
    const byWord = overlap(rawWords);
    const byStem = overlap(contentTokens);
    if (byStem.length >= minStemShared || byWord.length >= minWordShared) {
      const shared = [...new Set([...byStem, ...byWord])];
      findings.push({
        rule: 'explanation_echoes_answer',
        where: item.where,
        detail: `explanation repeats ${shared.join(', ')} from the correct option`,
      });
    }
  }
  return findings;
}

const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

type LengthMetric = 'characters' | 'words';

/**
 * Rank of the correct option when options are sorted longest first (0 = longest), as fractional
 * credit: tied options share the ranks they span, so a tie never favours a position.
 */
function rankCredit(item: AuthoringItem, metric: LengthMetric): number[] {
  const size = (o: string): number => (metric === 'characters' ? o.length : wordCount(o));
  const correct = size(item.options[item.correctAnswer] ?? '');
  const sizes = item.options.map(size);
  const longer = sizes.filter((x) => x > correct).length;
  const tied = sizes.filter((x) => x === correct).length;
  const credit = new Array<number>(item.options.length).fill(0);
  for (let r = longer; r < longer + tied; r += 1) credit[r] = 1 / tied;
  return credit;
}

/**
 * Rule 2: no length rank of the correct option may beat chance. For every rank (longest, second
 * longest, ...) and for both characters and words, the number of items whose correct option has
 * that rank must stay within chance plus 1.5 standard deviations (at least 1), per group and over
 * the whole set. "Pick the longest" and "pick the second longest" are both strategies that need no
 * knowledge, so neither may pay.
 */
export function checkLengthRanks(items: readonly AuthoringItem[]): AuthoringFinding[] {
  const findings: AuthoringFinding[] = [];
  const judge = (scope: string, subset: readonly AuthoringItem[]): void => {
    if (subset.length < 5) return;
    const maxOptions = Math.max(...subset.map((i) => i.options.length));
    for (const metric of ['characters', 'words'] as const) {
      const credits = subset.map((i) => rankCredit(i, metric));
      for (let rank = 0; rank < maxOptions; rank += 1) {
        let expected = 0;
        let variance = 0;
        let observed = 0;
        subset.forEach((item, idx) => {
          const p = rank < item.options.length ? 1 / item.options.length : 0;
          expected += p;
          variance += p * (1 - p);
          observed += credits[idx]?.[rank] ?? 0;
        });
        const allowed = Math.floor(expected + Math.max(1, 1.5 * Math.sqrt(variance)));
        if (observed > allowed) {
          findings.push({
            rule: 'length_rank_biased',
            where: scope,
            detail: `the correct option ranks #${String(rank + 1)} by ${metric} in ${observed.toFixed(1)} of ${String(subset.length)} items (allowed ${String(allowed)})`,
          });
        }
      }
    }
  };
  const groups = new Map<string, AuthoringItem[]>();
  for (const item of items) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  for (const [group, subset] of groups) judge(group, subset);
  judge('all items', items);
  return findings;
}

/**
 * Rule 3: near-duplicate question text. Items in different groups may overlap by at most 0.35
 * (Jaccard on 4+ letter words), items in the same group by at most 0.6. Identical correct-option
 * wording across groups is flagged as well.
 */
export function checkNearDuplicates(items: readonly AuthoringItem[]): AuthoringFinding[] {
  const findings: AuthoringFinding[] = [];
  const text = items.map((i) => rawWords(i.text));
  const answer = items.map((i) => contentTokens(i.options[i.correctAnswer] ?? ''));
  for (let a = 0; a < items.length; a += 1) {
    for (let b = a + 1; b < items.length; b += 1) {
      const x = items[a];
      const y = items[b];
      if (!x || !y) continue;
      const limit = x.group === y.group ? 0.6 : 0.35;
      const sim = jaccard(text[a] ?? new Set(), text[b] ?? new Set());
      if (sim > limit) {
        findings.push({
          rule: 'near_duplicate',
          where: y.where,
          detail: `question text is ${sim.toFixed(2)} similar to ${x.where}`,
        });
      } else if (
        x.group !== y.group &&
        (answer[a]?.size ?? 0) >= 3 &&
        jaccard(answer[a] ?? new Set(), answer[b] ?? new Set()) >= 0.8
      ) {
        findings.push({
          rule: 'near_duplicate',
          where: y.where,
          detail: `correct option repeats the correct option of ${x.where}`,
        });
      }
    }
  }
  return findings;
}

/**
 * Rule 4: a published pool holds at least `MIN_POOL_FACTOR` times the questions served per session,
 * otherwise retries replay the same items and the per-question feedback becomes a key oracle.
 */
export function checkPoolSizes(
  assessments: readonly { name: string; poolSize: number; questionsPerSession: number }[],
  factor = MIN_POOL_FACTOR,
): AuthoringFinding[] {
  return assessments
    .filter((a) => a.poolSize < a.questionsPerSession * factor)
    .map((a) => ({
      rule: 'pool_too_small' as const,
      where: a.name,
      detail: `pool of ${String(a.poolSize)} is smaller than ${String(factor)} x ${String(a.questionsPerSession)} questions per session`,
    }));
}

/** The item checks (rules 1 to 3). An empty result means the set is fit to publish. */
export function checkAuthoringSet(items: readonly AuthoringItem[]): AuthoringFinding[] {
  return [
    ...checkExplanationEchoes(items),
    ...checkLengthRanks(items),
    ...checkNearDuplicates(items),
  ];
}
