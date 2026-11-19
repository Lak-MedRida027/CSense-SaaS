import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCES } from '../../design/theme/ThemeContext';
import { createLearningStore } from '../data/learningStore';
import { initialView, navIdFor, reduceView, type View } from '../navigation';
import { PREFERENCES_KEY, loadPreferences, savePreferences } from '../preferences';
import { attemptDto, err, ok } from '../testing/fakeBridge';
import {
  M1,
  M2,
  badgesDto,
  overviewDto,
  quizDto,
  summary,
  xpDto,
} from '../testing/learningFixtures';
import { detectAchievements, hasAchievements } from './achievements';
import {
  lockedReasonText,
  lockedReasonsById,
  toModuleListItem,
  safeMotif,
  startBlockedReason,
  toBadgeData,
  toFinalCard,
  toFinalTarget,
  toModuleCardData,
  toQuizReview,
  toQuizTarget,
} from './mappers';
import type { QuizTarget } from './quizTarget';
import { createWatchTracker } from './watchProgress';

const target: QuizTarget = {
  kind: 'quiz',
  moduleId: M1,
  title: 'T',
  questionCount: 5,
  passingScore: 70,
  attemptNumber: 1,
};

describe('NAV1-NAV8: navigation reducer', () => {
  const dash: View = { name: 'dashboard' };
  it('NAV1 initial view: resume beats onboarding beats dashboard', () => {
    expect(initialView({ resumeTarget: target, onboardingRequired: true }).name).toBe('quiz');
    expect(initialView({ resumeTarget: null, onboardingRequired: true })).toEqual({
      name: 'onboarding',
    });
    expect(initialView({ resumeTarget: null, onboardingRequired: false })).toEqual(dash);
  });
  it('NAV2 nav ids map to views and unknown ids are ignored', () => {
    for (const id of ['dashboard', 'modules', 'badges', 'final']) {
      expect(reduceView(dash, { type: 'nav', navId: id })).toEqual({ name: id });
    }
    expect(reduceView(dash, { type: 'nav', navId: 'admin' })).toBe(dash);
  });
  it('NAV3 opening a module starts at the lesson; stages change in place', () => {
    const v = reduceView(dash, { type: 'openModule', moduleId: M1 });
    expect(v).toEqual({ name: 'module', moduleId: M1, stage: 'lesson' });
    expect(reduceView(v, { type: 'setStage', stage: 'practice' })).toEqual({
      ...v,
      stage: 'practice',
    });
    expect(reduceView(dash, { type: 'setStage', stage: 'practice' })).toBe(dash);
  });
  it('NAV4 a deep link to a locked or unknown module goes to the dashboard', () => {
    expect(
      reduceView({ name: 'badges' }, { type: 'deepLink', moduleId: M2, openable: false }),
    ).toEqual(dash);
    expect(
      reduceView({ name: 'badges' }, { type: 'deepLink', moduleId: M1, openable: true }).name,
    ).toBe('module');
  });
  it('NAV5 notifications never pull the user out of a quiz or onboarding', () => {
    const quiz: View = { name: 'quiz', target, returnTo: dash };
    expect(reduceView(quiz, { type: 'home', lockdownActive: false })).toBe(quiz);
    expect(reduceView(quiz, { type: 'deepLink', moduleId: M1, openable: true })).toBe(quiz);
    expect(reduceView({ name: 'onboarding' }, { type: 'home', lockdownActive: false })).toEqual({
      name: 'onboarding',
    });
    expect(reduceView({ name: 'badges' }, { type: 'home', lockdownActive: true })).toEqual({
      name: 'badges',
    });
    expect(reduceView({ name: 'badges' }, { type: 'home', lockdownActive: false })).toEqual(dash);
  });
  it('NAV6 quiz pass goes to the dashboard, fail returns to where it started', () => {
    const back: View = { name: 'module', moduleId: M1, stage: 'quiz' };
    const quiz: View = { name: 'quiz', target, returnTo: back };
    expect(reduceView(quiz, { type: 'quizDone', passed: true })).toEqual(dash);
    expect(reduceView(quiz, { type: 'quizDone', passed: false })).toEqual(back);
    expect(reduceView(dash, { type: 'quizDone', passed: true })).toBe(dash);
  });
  it('NAV7 onboarding done opens Module 1 or the dashboard', () => {
    expect(
      reduceView({ name: 'onboarding' }, { type: 'onboardingDone', openModuleId: M1 }).name,
    ).toBe('module');
    expect(
      reduceView({ name: 'onboarding' }, { type: 'onboardingDone', openModuleId: null }),
    ).toEqual(dash);
  });
  it('NAV8 the highlighted nav item follows the view', () => {
    expect(navIdFor({ name: 'module', moduleId: M1, stage: 'lesson' })).toBe('modules');
    expect(navIdFor({ name: 'final' })).toBe('final');
    expect(navIdFor({ name: 'onboarding' })).toBe('dashboard');
  });
});

describe('WT1-WT6: watch tracker', () => {
  const play = (
    t: ReturnType<typeof createWatchTracker>,
    from: number,
    to: number,
    dur: number,
  ) => {
    for (let s = from; s <= to; s += 1) t.update(s, dur);
  };
  it('WT1 contiguous play reaches 90%', () => {
    const t = createWatchTracker();
    play(t, 1, 8, 10);
    expect(t.watched()).toBe(false);
    play(t, 9, 9, 10);
    expect(t.watched()).toBe(true);
  });
  it('WT2 a forward seek does not count', () => {
    const t = createWatchTracker();
    t.update(1, 10);
    t.update(9.5, 10);
    expect(t.furthest()).toBe(1);
    expect(t.watched()).toBe(false);
    t.ended(10);
    expect(t.watched()).toBe(false);
  });
  it('WT3 seeking back is free and replaying the gap counts', () => {
    const t = createWatchTracker();
    play(t, 1, 5, 10);
    t.update(1, 10);
    expect(t.furthest()).toBe(5);
    play(t, 6, 9, 10);
    expect(t.watched()).toBe(true);
  });
  it('WT4 small steps within the tolerance advance, bigger jumps do not', () => {
    const t = createWatchTracker();
    t.update(1.9, 10);
    expect(t.furthest()).toBe(1.9);
    t.update(4.5, 10);
    expect(t.furthest()).toBe(1.9);
  });
  it('WT5 zero, NaN and negative values are ignored; ended near the end counts', () => {
    const t = createWatchTracker();
    t.update(1, 0);
    t.update(Number.NaN, 10);
    t.update(-1, 10);
    t.update(1, Number.NaN);
    expect(t.watched()).toBe(false);
    play(t, 1, 8, 10);
    t.ended(10);
    expect(t.watched()).toBe(true);
  });
  it('WT6 reset starts over for the next module', () => {
    const t = createWatchTracker();
    play(t, 1, 9, 10);
    t.reset();
    expect(t.watched()).toBe(false);
    expect(t.furthest()).toBe(0);
  });
});

describe('lock reasons name the module that actually blocks', () => {
  it('module N says Module N-1, whatever blocker the server reports', () => {
    const blockedBy1 = { moduleId: M1, position: 1, title: 'x' };
    const mods = [2, 3, 4].map((position) =>
      summary({
        id: String(position).repeat(24),
        position,
        status: 'locked',
        lockedBy: blockedBy1,
      }),
    );
    expect(lockedReasonsById(mods)).toEqual({
      ['2'.repeat(24)]: 'Pass the Module 1 quiz to unlock',
      ['3'.repeat(24)]: 'Pass the Module 2 quiz to unlock',
      ['4'.repeat(24)]: 'Pass the Module 3 quiz to unlock',
    });
    expect(toModuleListItem(mods[1] as never).lockedReason).toBe(
      'Pass the Module 2 quiz to unlock',
    );
    expect(lockedReasonsById([summary({ status: 'unlocked' })])).toEqual({});
  });
});

describe('MAP1-MAP8: mappers', () => {
  it('MAP1 lock reason text', () => {
    expect(lockedReasonText({ moduleId: M1, position: 3, title: 'x' })).toBe(
      'Pass the Module 3 quiz to unlock',
    );
    expect(lockedReasonText(null)).toBeUndefined();
  });
  it('MAP2 module cards carry score only when passed, and the badge name', () => {
    const done = toModuleCardData(
      summary({ status: 'completed', passed: true, bestScore: 80 }),
      'First Steps',
    );
    expect(done).toMatchObject({ order: 1, scorePercent: 80, badgeName: 'First Steps' });
    expect(toModuleCardData(summary({ bestScore: 40 })).scorePercent).toBeUndefined();
  });
  it('MAP3 unknown badge motifs fall back to a generic one', () => {
    expect(safeMotif('welcome')).toBe('welcome');
    expect(safeMotif('definitely-unknown')).toBe('trophy');
    expect(safeMotif('__proto__')).toBe('trophy');
    expect(toBadgeData(badgesDto().items[1] as never).motif).toBe('trophy');
  });
  it('MAP4 final card states', () => {
    expect(toFinalCard(null, 7).status).toBe('locked');
    const base = {
      status: 'locked' as const,
      title: 'F',
      questionCount: 15,
      passingScore: 70,
      remainingModules: 2,
      attempts: 0,
      bestScore: null,
      passed: false,
      completedAt: null,
    };
    expect(toFinalCard(base, 7)).toMatchObject({
      status: 'locked',
      lockedReason: 'Pass 2 more modules to unlock',
      questionCount: 15,
    });
    expect(toFinalCard({ ...base, remainingModules: 0 }, 7).lockedReason).toBe(
      'Unlocks after all 7 modules',
    );
    expect(
      toFinalCard({ ...base, status: 'completed', passed: true, bestScore: 93 }, 7),
    ).toMatchObject({ status: 'completed', scorePercent: 93 });
  });
  it('MAP5 quiz target carries pass mark and attempt, and a cooldown blocks the start', () => {
    const t = toQuizTarget(quizDto({ nextAttemptNumber: 3, passingScore: 60 }), 4, 'Phishing');
    expect(t).toMatchObject({
      kind: 'quiz',
      title: 'Module 4 quiz: Phishing',
      passingScore: 60,
      attemptNumber: 3,
    });
    expect((t as { startBlocked?: unknown }).startBlocked).toBeUndefined();
    const blocked = toQuizTarget(
      quizDto({
        canStart: false,
        blockedReason: 'cooldown',
        cooldownUntil: new Date(Date.now() + 60_000).toISOString(),
      }),
      1,
      'x',
    );
    expect(blocked.startBlocked?.reason).toMatch(/You can try again at/);
  });
  it('MAP6 already passed blocks the start with its own wording', () => {
    expect(
      startBlockedReason({ blockedReason: 'already_passed', cooldownUntil: null, passed: true }),
    ).toBe('You have already passed this quiz.');
    expect(
      startBlockedReason({ blockedReason: null, cooldownUntil: null, passed: false }),
    ).toBeUndefined();
    expect(
      startBlockedReason({ blockedReason: 'cooldown', cooldownUntil: 'garbage', passed: false }),
    ).toBe('You can try again a little later.');
  });
  it('MAP7 final target', () => {
    const f = {
      status: 'unlocked' as const,
      title: 'Final',
      questionCount: 15,
      passingScore: 70,
      remainingModules: 0,
      attempts: 1,
      bestScore: 50,
      passed: false,
      completedAt: null,
      finalTestId: M1,
      nextAttemptNumber: 2,
      canStart: true,
      blockedReason: null,
      cooldownUntil: null,
    };
    expect(toFinalTarget(f)).toMatchObject({ kind: 'final', attemptNumber: 2, questionCount: 15 });
  });
  it('MAP8 review: correctOptionId only with correctIndex, explanation only when sent', () => {
    const base = {
      questionId: M1,
      text: 'Q',
      options: ['a', 'b'],
      selectedIndex: 0,
      correct: false,
    };
    const r = toQuizReview(
      attemptDto({
        review: [
          base,
          { ...base, questionId: M2, selectedIndex: null, correctIndex: 1, explanation: 'why' },
        ],
      }),
    );
    expect(r.questions[0]).toMatchObject({ wasCorrect: false });
    expect(r.questions[0]?.correctOptionId).toBeUndefined();
    expect(r.questions[0]?.explanation).toBeUndefined();
    expect(r.questions[1]).toMatchObject({ correctOptionId: '1', explanation: 'why' });
    expect(r.answers).toEqual({ [M1]: '0', [M2]: null });
    expect(toQuizReview(attemptDto({ review: [] })).questions).toEqual([]);
  });
});

describe('ACH1-ACH4: detectAchievements', () => {
  const before = xpDto();
  const aware = xpDto({ totalXP: 330, level: 'Aware', tier: 2 });
  const badge = { id: 'b', name: 'First Steps', iconMotif: 'welcome' };
  it('ACH1 a badge only', () => {
    const a = detectAchievements(
      before,
      xpDto({ totalXP: 100 }),
      attemptDto({ effects: { badge } }),
    );
    expect(a).toEqual({ badge: { id: 'b', name: 'First Steps', motif: 'welcome' } });
  });
  it('ACH2 a level-up', () => {
    expect(detectAchievements(before, aware, attemptDto()).levelUp).toEqual({
      from: 'Apprentice',
      to: 'Aware',
    });
  });
  it('ACH3 both, and nothing for a failed attempt', () => {
    const both = detectAchievements(before, aware, attemptDto({ effects: { badge } }));
    expect(both.badge && both.levelUp).toBeTruthy();
    expect(
      hasAchievements(
        detectAchievements(before, aware, attemptDto({ passed: false, effects: { badge } })),
      ),
    ).toBe(false);
  });
  it('ACH4 a final pass is training complete; no before means no level-up claim', () => {
    const f = detectAchievements(null, aware, attemptDto({ kind: 'FinalTest' }));
    expect(f).toEqual({ trainingComplete: true });
  });
});

describe('PREF1-PREF4: preferences', () => {
  const mem = (initial?: string) => {
    const data = new Map<string, string>(initial ? [[PREFERENCES_KEY, initial]] : []);
    return {
      data,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
  };
  it('PREF1 round trip', () => {
    const s = mem();
    savePreferences(s, { theme: 'light', motion: 'reduced', textSize: 'large' });
    expect(loadPreferences(s)).toEqual({ theme: 'light', motion: 'reduced', textSize: 'large' });
  });
  it('PREF2 corrupt, wrong version and non-objects fall back to defaults', () => {
    for (const raw of [
      '{bad',
      '{"v":2,"prefs":{"theme":"light"}}',
      'null',
      '"x"',
      '{"v":1}',
      '[]',
    ]) {
      expect(loadPreferences(mem(raw)), raw).toEqual(DEFAULT_PREFERENCES);
    }
    expect(loadPreferences(null)).toEqual(DEFAULT_PREFERENCES);
  });
  it('PREF3 unknown values fall back per field', () => {
    const s = mem('{"v":1,"prefs":{"theme":"neon","motion":"reduced","textSize":9}}');
    expect(loadPreferences(s)).toEqual({ ...DEFAULT_PREFERENCES, motion: 'reduced' });
  });
  it('PREF4 only the csense.ui.v1 key is written, with only the three preferences', () => {
    const s = mem();
    savePreferences(s, { ...DEFAULT_PREFERENCES, extra: 'token' } as never);
    expect([...s.data.keys()]).toEqual([PREFERENCES_KEY]);
    expect(JSON.parse(s.data.get(PREFERENCES_KEY) as string)).toEqual({
      v: 1,
      prefs: DEFAULT_PREFERENCES,
    });
    expect(() => {
      savePreferences(
        {
          getItem: () => null,
          setItem: () => {
            throw new Error('full');
          },
        },
        DEFAULT_PREFERENCES,
      );
    }).not.toThrow();
  });
});

describe('learningStore', () => {
  const bridge = () => ({
    learning: { getOverview: vi.fn(() => Promise.resolve(ok(overviewDto()))) },
    me: {
      getXp: vi.fn(() => Promise.resolve(ok(xpDto()))),
      getBadges: vi.fn(() => Promise.resolve(ok(badgesDto()))),
    },
  });
  it('loads the three slices in parallel and keeps stale data on a failed refresh', async () => {
    const b = bridge();
    const store = createLearningStore(b as never);
    expect(store.getState().overview.status).toBe('idle');
    await store.refresh();
    expect(store.getState().xp.data?.totalXP).toBe(10);
    b.me.getXp.mockResolvedValueOnce(err('NETWORK_UNAVAILABLE'));
    await store.refresh(['xp']);
    expect(store.getState().xp).toMatchObject({
      status: 'ready',
      error: { code: 'NETWORK_UNAVAILABLE' },
    });
    expect(store.getState().xp.data?.totalXP).toBe(10);
  });
  it('a first failure is an error state; a thrown bridge call is a network error', async () => {
    const b = bridge();
    b.learning.getOverview.mockRejectedValueOnce(new Error('boom'));
    const store = createLearningStore(b as never);
    await store.refresh(['overview']);
    expect(store.getState().overview).toMatchObject({
      status: 'error',
      data: null,
      error: { code: 'NETWORK_UNAVAILABLE' },
    });
  });
  it('E12: clear() empties the cache and drops in-flight reads', async () => {
    const b = bridge();
    let release!: () => void;
    b.me.getXp.mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = () => {
            r(ok(xpDto({ totalXP: 999 })));
          };
        }) as never,
    );
    const store = createLearningStore(b as never);
    const pending = store.refresh(['xp']);
    store.clear();
    release();
    await pending;
    expect(store.getState().xp).toEqual({ status: 'idle', data: null, error: null });
    await store.refresh();
    store.clear();
    expect(store.getState().overview.data).toBeNull();
    expect(store.getState().badges.data).toBeNull();
  });
});
