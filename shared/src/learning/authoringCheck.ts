/**
 * Content-quality checks for multiple-choice items (Phase 3, reused by Phase 7 content management).
 * The reveal policy (ADR 0007) shows an explanation after a failed attempt, and retries are
 * unlimited, so an item that gives its answer away defeats the quiz. These pure functions flag
 * three authoring mistakes:
 *  1. an explanation that repeats distinctive words of the correct option;
 *  2. an assessment where the correct option is the longest one too often;
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
  'explanation_echoes_answer' | 'longest_option_correct' | 'near_duplicate' | 'pool_too_small';

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

/** Lower-cased words of 4+ letters, minus stopwords, lightly stemmed so "reports" matches "report". */
export function contentTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (raw.length < 4 || STOPWORDS.has(raw)) continue;
    let w = raw;
    for (const suffix of ['ing', 'ed', 'es', 's']) {
      if (w.endsWith(suffix) && w.length - suffix.length >= 4) {
        w = w.slice(0, -suffix.length);
        break;
      }
    }
    out.add(w);
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
  options: { minShared?: number } = {},
): AuthoringFinding[] {
  const minShared = options.minShared ?? 2;
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
    // Count the larger of the plain-word and stemmed overlap, so plurals do not double count.
    const byWord = overlap(rawWords);
    const byStem = overlap(contentTokens);
    const shared = byWord.length >= byStem.length ? byWord : byStem;
    if (shared.length >= minShared) {
      findings.push({
        rule: 'explanation_echoes_answer',
        where: item.where,
        detail: `explanation repeats ${shared.join(', ')} from the correct option`,
      });
    }
  }
  return findings;
}

const isFirstLongest = (item: AuthoringItem): boolean => {
  const lengths = item.options.map((o) => o.length);
  return lengths.indexOf(Math.max(...lengths)) === item.correctAnswer;
};

/**
 * Rule 2: "pick the longest option" must not beat chance by more than a small margin, per group and
 * over the whole set. Chance is the sum of 1/optionCount; the margin is max(1, 5% of the items).
 */
export function checkLongestOption(items: readonly AuthoringItem[]): AuthoringFinding[] {
  const findings: AuthoringFinding[] = [];
  const judge = (scope: string, subset: readonly AuthoringItem[]): void => {
    if (subset.length < 3) return;
    const expected = subset.reduce((sum, i) => sum + 1 / Math.max(i.options.length, 1), 0);
    const allowed = Math.floor(expected + Math.max(1, Math.ceil(subset.length * 0.05)));
    const longest = subset.filter(isFirstLongest).length;
    if (longest > allowed) {
      findings.push({
        rule: 'longest_option_correct',
        where: scope,
        detail: `the correct option is the longest in ${String(longest)} of ${String(subset.length)} items (allowed ${String(allowed)})`,
      });
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
  factor = 2,
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
    ...checkLongestOption(items),
    ...checkNearDuplicates(items),
  ];
}
