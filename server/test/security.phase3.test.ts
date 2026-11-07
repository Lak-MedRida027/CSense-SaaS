/**
 * Phase 3 independent security review: adversarial regression tests for the learning engine.
 *
 * Every test here was written while attacking the Phase 3 learning engine (modules, exercises,
 * assessment sessions, grading, reveal policy, attempt history, hooks, seed). Same conventions as
 * security.phase2.test.ts: a test that exposes a real, still-open defect uses `it.fails` and names
 * the finding ID from the review report (P3-...), so the suite stays green until the fix lands.
 * When a fix lands its `it.fails` starts failing: flip it to `it` in the same PR.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import mongoose, { Types } from 'mongoose';
import type request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  attemptResultSchema,
  type AssessmentSessionDTO,
  type AttemptResultDTO,
  type ReviewItemDTO,
} from '@csense/shared';
import type { AppConfig } from '../src/config/appConfig.js';
import { EMPLOYEE_ONLY } from '../src/http/routeRegistry.js';
import {
  Assessment,
  AssessmentSession,
  Module,
  QuizAttempt,
  UserProgress,
} from '../src/models/index.js';
import { allRoutes } from '../src/routes.js';
import { validateSeedContent } from '../src/scripts/seedLearning.js';
import { buildTestApp, createAdmin, loginOk, makeCredentials } from './helpers/fixtures.js';
import {
  answersFor,
  clientFor,
  completeContent,
  createCurriculum,
  createFinalTest,
  passModule,
  scanForKeys,
  signedInEmployee,
  spyHooks,
  startQuiz,
  submitQuiz,
  syncLearningIndexes,
  type Client,
} from './helpers/learningFixtures.js';
import { testConfig } from './helpers/testConfig.js';

let creds: { password: string; hash: string };

beforeAll(async () => {
  creds = await makeCredentials();
  await syncLearningIndexes();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const need = <T>(v: T | undefined | null): T => {
  if (v === undefined || v === null) throw new Error('fixture');
  return v;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const review = (res: request.Response): ReviewItemDTO[] => (res.body as AttemptResultDTO).review;

const unknownId = (): string => new Types.ObjectId().toHexString();

async function sessionStatus(id: string): Promise<string | undefined> {
  return (await AssessmentSession.findById(id).lean())?.status;
}

/** Wait (bounded) until a predicate on the database holds. */
async function waitFor(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return;
    await sleep(10);
  }
  throw new Error('condition not reached');
}

/** A stored attempt built directly (model-level tests). */
const sampleAttempt = (passed = false) => ({
  userId: new Types.ObjectId(),
  type: 'Quiz' as const,
  refId: new Types.ObjectId(),
  answers: [{ questionId: new Types.ObjectId(), selectedIndex: 1, correct: passed }],
  score: passed ? 100 : 0,
  passed,
  sessionId: new Types.ObjectId(),
  moduleId: new Types.ObjectId(),
  attemptNumber: 1,
  endReason: 'submitted' as const,
  correctCount: passed ? 1 : 0,
  totalCount: 1,
  passingScore: 70,
});

// =================================================================================================
describe('SEC3-RB: route registry', () => {
  it('RB1: every learning route is EMPLOYEE_ONLY; none is public, any-auth or admin', () => {
    const config: AppConfig = testConfig();
    const routes = allRoutes({ config, clock: () => new Date(), isReady: () => true }).filter((r) =>
      /^\/(modules|final-test|me\/attempts)/.test(r.path),
    );
    expect(routes).toHaveLength(15);
    for (const r of routes) expect(r.access, `${r.method} ${r.path}`).toEqual(EMPLOYEE_ONLY);
  });
});

// =================================================================================================
describe('SEC3-KL: answer-key leakage', () => {
  it('KL1: before a pass, no response, error or header on any route carries a key', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 2, interactive: [1] });
    const [m1, m2] = [need(c.modules[0]), need(c.modules[1])];
    await createFinalTest(c.keys, 5);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1); // exercise feedback carries the exercise key by design

    const seen: [string, request.Response][] = [];
    const { res: started, session } = await startQuiz(emp, m1.id);
    seen.push(['session', started]);
    const q0 = need(session.questions[0]).questionId;
    const submitPath = `/modules/${m1.id}/quiz/attempts`;
    seen.push([
      '400 out of range',
      await emp.post(submitPath, {
        sessionId: session.sessionId,
        answers: [{ questionId: q0, selectedIndex: 5 }],
      }),
    ]);
    seen.push([
      '400 not served',
      await emp.post(submitPath, {
        sessionId: session.sessionId,
        answers: [{ questionId: need(m2.questionIds[0]), selectedIndex: 0 }],
      }),
    ]);
    const failed = await submitQuiz(emp, m1.id, session, c.keys, 2);
    expect(failed.status).toBe(201);
    seen.push(['failed result', failed]);
    seen.push(['409 replay', await submitQuiz(emp, m1.id, session, c.keys, 5)]);
    const { res: second } = await startQuiz(emp, m1.id);
    seen.push(['session 2', second]);
    const abandoned = await emp.post(
      `/modules/${m1.id}/quiz/sessions/${String(second.body.sessionId)}/abandon`,
    );
    seen.push(['abandon', abandoned]);
    for (const p of [
      '/modules',
      `/modules/${m1.id}`,
      `/modules/${m1.id}/quiz`,
      `/modules/${m2.id}`,
      `/modules/${m2.id}/quiz`,
      '/final-test',
      '/me/attempts',
      `/me/attempts/${String(failed.body.attemptId)}`,
      `/me/attempts/${String(abandoned.body.attemptId)}`,
    ]) {
      seen.push([p, await emp.get(p)]);
    }
    seen.push(['final locked', await emp.post('/final-test/sessions')]);
    seen.push(['m2 locked', await emp.post(`/modules/${m2.id}/quiz/sessions`)]);

    for (const [name, res] of seen) {
      const leaks = scanForKeys(res.body).filter(
        (p) => !/^\$\.review\[\d+\]\.explanation$/.test(p),
      );
      expect(leaks, name).toEqual([]);
      expect(JSON.stringify(res.headers), name).not.toMatch(/correct|explanation|answer/i);
    }
    // The failed review explains but never names the option; the abandoned one is empty.
    expect(review(failed).every((r) => typeof r.explanation === 'string')).toBe(true);
    expect(review(abandoned)).toEqual([]);
  });

  it('KL2: the exercise endpoint never resolves a quiz, final-test or foreign exercise id', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 2, interactive: [1, 2] });
    const [m1, m2] = [need(c.modules[0]), need(c.modules[1])];
    const ft = await createFinalTest(c.keys, 5);
    const emp = await signedInEmployee(t.app, creds);
    expect((await emp.post(`/modules/${m1.id}/start`)).status).toBe(200);

    for (const id of [
      need(m1.questionIds[0]),
      need(ft.questionIds[0]),
      m1.quizId,
      need(m2.exerciseIds[0]),
      m1.id,
      unknownId(),
    ]) {
      const res = await emp.post(`/modules/${m1.id}/exercises/${id}/answers`, {
        selectedIndex: 0,
      });
      expect(res.status, id).toBe(404);
      expect(scanForKeys(res.body)).toEqual([]);
    }
    // Module 2's own exercise is behind the lock.
    const locked = await emp.post(
      `/modules/${m2.id}/exercises/${need(m2.exerciseIds[0])}/answers`,
      { selectedIndex: 0 },
    );
    expect(locked.status).toBe(403);
    expect(scanForKeys(locked.body)).toEqual([]);
    expect((await UserProgress.findOne({ userId: emp.id }).lean())?.exerciseAnswers).toEqual([]);
  });

  it('KL3: abandoned and expired attempts reveal nothing, even after the quiz is passed', async () => {
    // A short session TTL keeps the clock jump inside the 15-minute access token.
    const t = await buildTestApp({ learning: { sessionTtlSeconds: 300 } });
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);

    const { session: s1 } = await startQuiz(emp, m1.id);
    const ab = await emp.post(`/modules/${m1.id}/quiz/sessions/${s1.sessionId}/abandon`);
    expect(ab.status).toBe(201);
    const { session: s2 } = await startQuiz(emp, m1.id);
    t.advance(t.config.learning.sessionTtlSeconds * 1000 + 1);
    const late = await submitQuiz(emp, m1.id, s2, c.keys, 5);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('SESSION_EXPIRED');
    expect(scanForKeys(late.body)).toEqual([]);
    const { session: s3 } = await startQuiz(emp, m1.id);
    expect((await submitQuiz(emp, m1.id, s3, c.keys, 5)).body.passed).toBe(true);

    const expired = need(await QuizAttempt.findOne({ endReason: 'expired' }).lean());
    for (const id of [String(ab.body.attemptId), expired._id.toHexString()]) {
      const res = await emp.get(`/me/attempts/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.review).toEqual([]);
    }
  });

  it('KL4: passing a module quiz does not reveal the key of the final test', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    await createFinalTest(c.keys, 5);
    const emp = await signedInEmployee(t.app, creds);
    const passed = await passModule(emp, m1, c.keys);
    expect(review(passed).every((r) => typeof r.correctIndex === 'number')).toBe(true);

    const start = await emp.post('/final-test/sessions');
    expect(start.status).toBe(201);
    const failed = await emp.post('/final-test/attempts', {
      sessionId: start.body.sessionId,
      answers: answersFor(start.body as AssessmentSessionDTO, c.keys, 2),
    });
    expect(failed.status).toBe(201);
    expect(failed.body.passed).toBe(false);
    expect(review(failed).some((r) => 'correctIndex' in r)).toBe(false);
    const detail = await emp.get(`/me/attempts/${String(failed.body.attemptId)}`);
    expect(review(detail).some((r) => 'correctIndex' in r)).toBe(false);
  });

  it('KL5: a pass by another employee does not unlock the correct option in my review', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const a = await signedInEmployee(t.app, creds);
    const b = await signedInEmployee(t.app, creds);
    await passModule(a, m1, c.keys);
    await completeContent(b, m1);
    const { session } = await startQuiz(b, m1.id);
    const failed = await submitQuiz(b, m1.id, session, c.keys, 1);
    expect(failed.status).toBe(201);
    expect(review(failed).some((r) => 'correctIndex' in r)).toBe(false);
    const detail = await b.get(`/me/attempts/${String(failed.body.attemptId)}`);
    expect(review(detail).some((r) => 'correctIndex' in r)).toBe(false);
  });

  // ---- Content: the reveal policy is only as strong as the authored items (P3-M2) -------------
  const seed = validateSeedContent();
  const seedQuestions = [
    ...[...seed.quizzes.entries()].flatMap(([order, quiz]) =>
      quiz.questions.map((q, i) => ({ where: `quiz${String(order)}.${String(i)}`, ...q })),
    ),
    ...seed.finalTest.questions.map((q, i) => ({ where: `final.${String(i)}`, ...q })),
  ];
  const words = (s: string): Set<string> => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);

  // P3-M2: the explanation is shown after a FAILED attempt (D3-13). Several seeded explanations
  // repeat two or more distinctive words of the correct option, so the first failed review names
  // the answer. SD5 only checks for the whole option text as a substring.
  it('KL6 [P3-M2]: no explanation repeats the distinctive words of the correct option', () => {
    const flagged = seedQuestions.filter((q) => {
      const others = new Set(
        q.options.filter((_, i) => i !== q.correctAnswer).flatMap((o) => [...words(o)]),
      );
      const distinctive = [...words(q.options[q.correctAnswer] ?? '')].filter(
        (w) => !others.has(w),
      );
      const expl = words(q.explanation);
      return distinctive.filter((w) => expl.has(w)).length >= 2;
    });
    expect(flagged.map((q) => q.where)).toEqual([]);
  });

  // P3-M2: the correct option is the longest one in 37 of 50 seeded items. "Pick the longest
  // option" passes 4 of the 7 module quizzes on the first attempt without reading anything, which
  // inflates the first-attempt Knowledge input Phase 4 relies on (ADR 0007).
  it('KL7 [P3-M2]: picking the longest option does not pass any seeded quiz', () => {
    const passing = [...seed.quizzes.entries()]
      .filter(([, quiz]) => {
        const right = quiz.questions.filter((q) => {
          const lengths = q.options.map((o) => o.length);
          return lengths.indexOf(Math.max(...lengths)) === q.correctAnswer;
        }).length;
        return 100 * right >= quiz.passingScore * quiz.questions.length;
      })
      .map(([order]) => order);
    expect(passing).toEqual([]);
  });

  // P3-M2: the plan promises "15 new questions" for the final test, but three are near-copies of
  // exercises (whose key every employee is shown by design) and two of module quiz items (whose
  // key is shown once that module is passed, a precondition of the final test).
  it('KL8 [P3-M2]: final-test items are not copies of exercises or module quiz items', () => {
    const jaccard = (a: Set<string>, b: Set<string>): number => {
      const inter = [...a].filter((x) => b.has(x)).length;
      return inter / (a.size + b.size - inter || 1);
    };
    const disclosed = [
      ...seed.modules.flatMap((m) => m.exercises.map((e) => e.prompt)),
      ...[...seed.quizzes.values()].flatMap((quiz) => quiz.questions.map((q) => q.text)),
    ].map(words);
    const copies = seed.finalTest.questions
      .map((q, i) => ({ i, w: words(q.text) }))
      .filter(({ w }) => disclosed.some((d) => jaccard(w, d) > 0.35))
      .map(({ i }) => `final.${String(i)}`);
    expect(copies).toEqual([]);
  });
});

// =================================================================================================
describe('SEC3-RP: reveal-policy inference', () => {
  /**
   * A zero-knowledge client that only reads API responses: it answers every question with the
   * first option it has not yet seen marked wrong, and keeps answers marked right. Question ids are
   * stable across sessions and option order is fixed, so shuffling the question order does not help.
   */
  async function eliminationGuesser(
    c: Client,
    startPath: string,
    submitPath: string,
    maxAttempts: number,
    served: string[][] = [],
  ): Promise<number | 'cooldown' | null> {
    const known = new Map<string, number>();
    const next = new Map<string, number>();
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const started = await c.post(startPath);
      if (started.status === 409 && started.body.error?.code === 'ASSESSMENT_COOLDOWN') {
        return 'cooldown';
      }
      if (started.status !== 201) throw new Error(`start ${String(started.status)}`);
      const session = started.body as AssessmentSessionDTO;
      served.push(session.questions.map((q) => q.questionId));
      const answers = session.questions.map((q) => ({
        questionId: q.questionId,
        selectedIndex: known.get(q.questionId) ?? next.get(q.questionId) ?? 0,
      }));
      const res = await c.post(submitPath, { sessionId: session.sessionId, answers });
      if (res.status !== 201) throw new Error(`submit ${String(res.status)}`);
      if (res.body.passed === true) return attempt;
      for (const item of review(res)) {
        const chosen = answers.find((a) => a.questionId === item.questionId)?.selectedIndex ?? 0;
        if (item.correct) known.set(item.questionId, chosen);
        else next.set(item.questionId, chosen + 1);
      }
    }
    return null;
  }

  // P3-M1: per-question right/wrong on a failed attempt + stable question ids + fixed option order
  // + unlimited retries with no cooldown = a deterministic key oracle. With k options per question
  // any quiz is passed in at most k attempts with zero knowledge (here: 3 for the 5-question quiz,
  // 3 for the 15-question final test). The expectation below is what a fix should achieve.
  // P3-M1 decision: question pool plus cooldown. The guesser above relied on stable question ids and
  // unlimited retries; it is now defeated twice over. Adaptation of the original assertion (which
  // expected "never passes in 4 attempts" without any other mechanism): the app runs with a pool
  // (20 questions for the quiz, 30 for the final test, serving 5 and 15) and a cooldown after 3
  // failed attempts, and the injected identity shuffle makes the draw deterministic, so the test
  // cannot flake on a lucky random draw. The expectation is that the guesser (a) never passes,
  // (b) reaches the cooldown instead of a fourth attempt, and (c) on the quiz meets only unseen
  // questions in every session, so what it learned from the feedback is worthless.
  it('RP1 [P3-M1]: a zero-knowledge guesser cannot pass a quiz or the final test and hits the cooldown', async () => {
    const identity = <T>(items: readonly T[]): T[] => [...items];
    const t = await buildTestApp(
      { learning: { cooldownAfterFails: 3, cooldownMinutes: 15 } },
      { shuffle: identity },
    );
    const c = await createCurriculum({ count: 1, questions: 20, questionsPerSession: 5 });
    const m1 = need(c.modules[0]);
    await createFinalTest(c.keys, 30, 70, 15);
    const quizTaker = await signedInEmployee(t.app, creds);
    await completeContent(quizTaker, m1);

    const quizSessions: string[][] = [];
    const quiz = await eliminationGuesser(
      quizTaker,
      `/modules/${m1.id}/quiz/sessions`,
      `/modules/${m1.id}/quiz/attempts`,
      4,
      quizSessions,
    );
    expect(quiz).toBe('cooldown');
    expect(quizSessions).toHaveLength(3);
    // Every session drew questions the guesser had never been shown.
    const seenBefore = new Set<string>();
    for (const session of quizSessions) {
      expect(session.filter((id) => seenBefore.has(id))).toEqual([]);
      session.forEach((id) => seenBefore.add(id));
    }

    // The final test is reached by a second employee who passed the module honestly.
    const finalTaker = await signedInEmployee(t.app, creds);
    await passModule(finalTaker, m1, c.keys);
    const final = await eliminationGuesser(
      finalTaker,
      '/final-test/sessions',
      '/final-test/attempts',
      4,
    );
    expect(final).toBe('cooldown');
  });
});

// =================================================================================================
describe('SEC3-PT: progression tampering', () => {
  it('PT1: bad indexes, nulls and wrong types are 400 and keep the session open', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    const q0 = need(session.questions[0]).questionId;
    const path = `/modules/${m1.id}/quiz/attempts`;

    // Fixture questions have 4 options: 4 and 5 pass zod but fail the per-question bound.
    for (const selectedIndex of [4, 5, 6, -1, 1.5, '1', true, { $gt: -1 }, [1]]) {
      const res = await emp.post(path, {
        sessionId: session.sessionId,
        answers: [{ questionId: q0, selectedIndex }],
      });
      expect(res.status, JSON.stringify(selectedIndex)).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain(q0);
    }
    // An answers object, a missing array, a duplicate in another case.
    for (const answers of [
      { [q0]: 1 },
      undefined,
      [
        { questionId: q0, selectedIndex: 0 },
        { questionId: q0.toUpperCase(), selectedIndex: 1 },
      ],
    ]) {
      expect((await emp.post(path, { sessionId: session.sessionId, answers })).status).toBe(400);
    }
    expect(await sessionStatus(session.sessionId)).toBe('open');
    expect(await QuizAttempt.countDocuments({})).toBe(0);

    // All-null is a graded zero, not an error and not a pass.
    const nulls = await emp.post(path, {
      sessionId: session.sessionId,
      answers: session.questions.map((q) => ({ questionId: q.questionId, selectedIndex: null })),
    });
    expect(nulls.status).toBe(201);
    expect(nulls.body.score).toBe(0);
    expect(review(nulls).every((r) => r.selectedIndex === null && !r.correct)).toBe(true);
  });

  it('PT2: answers for questions of another quiz or the final test are 400; ids are not echoed', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 2 });
    const [m1, m2] = [need(c.modules[0]), need(c.modules[1])];
    const ft = await createFinalTest(c.keys, 5);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    const honest = answersFor(session, c.keys, 5);
    for (const foreign of [need(m2.questionIds[0]), need(ft.questionIds[0]), unknownId()]) {
      const res = await emp.post(`/modules/${m1.id}/quiz/attempts`, {
        sessionId: session.sessionId,
        answers: [...honest.slice(0, 4), { questionId: foreign, selectedIndex: 0 }],
      });
      expect(res.status).toBe(400);
      expect(res.body.error.details.issues).toEqual([
        {
          location: 'body',
          path: 'answers.4.questionId',
          message: 'was not served in this session',
        },
      ]);
      expect(JSON.stringify(res.body)).not.toContain(foreign);
    }
    expect(await sessionStatus(session.sessionId)).toBe('open');
  });

  it('PT3: prototype-pollution and smuggled keys in the submit body are rejected', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    const answers = JSON.stringify(answersFor(session, c.keys, 0));
    for (const extra of [
      '"__proto__":{"passed":true,"score":100}',
      '"constructor":{"prototype":{"passed":true}}',
    ]) {
      const raw = `{"sessionId":"${session.sessionId}","answers":${answers},${extra}}`;
      const res = await emp
        .post(`/modules/${m1.id}/quiz/attempts`)
        .set('Content-Type', 'application/json')
        .send(raw);
      expect(res.status, extra).toBe(400);
    }
    expect(await QuizAttempt.countDocuments({})).toBe(0);
    expect(({} as Record<string, unknown>).passed).toBeUndefined();
  });

  it('PT4: the final test cannot be started or submitted early, even with a planted session', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 2 });
    const m1 = need(c.modules[0]);
    const ft = await createFinalTest(c.keys, 5);
    const emp = await signedInEmployee(t.app, creds);
    await passModule(emp, m1, c.keys);

    expect((await emp.post('/final-test/sessions')).body.error.code).toBe('FINAL_TEST_LOCKED');
    expect((await emp.get('/final-test')).body.canStart).toBe(false);
    const planted = await AssessmentSession.create({
      userId: emp.id,
      kind: 'FinalTest',
      assessmentId: ft.id,
      moduleId: null,
      questions: ft.questionIds.map((questionId) => ({
        questionId,
        optionCount: 4,
        correctAnswer: need(c.keys.get(questionId)),
      })),
      passingScore: 70,
      expiresAt: new Date(t.clock().getTime() + 3_600_000),
    });
    const res = await emp.post('/final-test/attempts', {
      sessionId: planted.id,
      answers: ft.questionIds.map((questionId) => ({
        questionId,
        selectedIndex: need(c.keys.get(questionId)),
      })),
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FINAL_TEST_LOCKED');
    expect(await sessionStatus(planted.id)).toBe('open');
    expect(await QuizAttempt.countDocuments({ type: 'FinalTest' })).toBe(0);
  });

  it('PT5: content cannot be completed without answering every exercise of this module', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 2, interactive: [1, 2] });
    const [m1, m2] = [need(c.modules[0]), need(c.modules[1])];
    const emp = await signedInEmployee(t.app, creds);
    expect((await emp.post(`/modules/${m1.id}/start`)).status).toBe(200);
    const first = need(m1.exerciseIds[0]);
    for (let i = 0; i < 3; i += 1) {
      await emp.post(`/modules/${m1.id}/exercises/${first}/answers`, { selectedIndex: i % 2 });
    }
    // Another module's exercise does not count for this one.
    const foreign = await emp.post(
      `/modules/${m1.id}/exercises/${need(m2.exerciseIds[1])}/answers`,
      { selectedIndex: 0 },
    );
    expect(foreign.status).toBe(404);
    expect((await emp.post(`/modules/${m1.id}/content/complete`)).body.error.code).toBe(
      'CONTENT_INCOMPLETE',
    );
    expect((await emp.post(`/modules/${m1.id}/quiz/sessions`)).body.error.code).toBe(
      'CONTENT_INCOMPLETE',
    );
    expect((await emp.get(`/modules/${m1.id}/quiz`)).body.blockedReason).toBe('content_incomplete');
    const row = await UserProgress.findOne({ userId: emp.id }).lean();
    expect(row?.exerciseAnswers).toHaveLength(1);
    expect(row?.contentCompletedAt).toBeNull();
  });

  it('PT6: case-folded ids resolve to the same resource; operators in query or body are 400', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 2, interactive: [1] });
    const [m1, m2] = [need(c.modules[0]), need(c.modules[1])];
    const emp = await signedInEmployee(t.app, creds);
    const upper = await emp.get(`/modules/${m1.id.toUpperCase()}`);
    expect(upper.status).toBe(200);
    expect(upper.body.module.id).toBe(m1.id);
    // The lock is not bypassed by a differently-cased id.
    expect((await emp.get(`/modules/${m2.id.toUpperCase()}`)).status).toBe(403);
    expect((await emp.post(`/modules/${m2.id.toUpperCase()}/start`)).status).toBe(403);
    for (const q of [
      'kind[$ne]=Quiz',
      'before[$gt]=0',
      'limit[$gt]=1',
      'moduleId[$exists]=true',
      `userId=${emp.id}`,
      'kind=Quiz&kind=FinalTest',
    ]) {
      expect((await emp.get(`/me/attempts?${q}`)).status, q).toBe(400);
    }
    const op = await emp.post(`/modules/${m1.id}/exercises/${need(m1.exerciseIds[0])}/answers`, {
      selectedIndex: { $gt: -1 },
    });
    expect(op.status).toBe(400);
    expect(await UserProgress.countDocuments({})).toBe(0);
  });
});

// =================================================================================================
describe('SEC3-ID: IDOR on sessions and attempts', () => {
  it('ID1: attempts and sessions of another employee are indistinguishable from unknown ids', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 2 });
    const [m1, m2] = [need(c.modules[0]), need(c.modules[1])];
    await createFinalTest(c.keys, 5);
    const a = await signedInEmployee(t.app, creds);
    const b = await signedInEmployee(t.app, creds);

    const theirAttempt = String((await passModule(a, m1, c.keys)).body.attemptId);
    await completeContent(a, m2);
    const { session: theirs } = await startQuiz(a, m2.id);
    await completeContent(b, m1);
    const { session: mine } = await startQuiz(b, m1.id);

    // Attempt detail and cursor.
    const detailTheirs = await b.get(`/me/attempts/${theirAttempt}`);
    const detailUnknown = await b.get(`/me/attempts/${unknownId()}`);
    expect([detailTheirs.status, detailUnknown.status]).toEqual([404, 404]);
    expect(detailTheirs.body).toEqual(detailUnknown.body);
    const cursorTheirs = await b.get(`/me/attempts?before=${theirAttempt}`);
    const cursorUnknown = await b.get(`/me/attempts?before=${unknownId()}`);
    expect([cursorTheirs.status, cursorUnknown.status]).toEqual([400, 400]);
    expect(cursorTheirs.body).toEqual(cursorUnknown.body);
    // Filters never widen the scope.
    for (const q of [`moduleId=${m1.id}`, 'kind=Quiz', `moduleId=${m1.id}&kind=Quiz&limit=100`]) {
      expect((await b.get(`/me/attempts?${q}`)).body.items).toEqual([]);
    }
    // Their open session on my accessible module-1 route versus a random id.
    const submitTheirs = await b.post(`/modules/${m1.id}/quiz/attempts`, {
      sessionId: theirs.sessionId,
      answers: [],
    });
    const submitUnknown = await b.post(`/modules/${m1.id}/quiz/attempts`, {
      sessionId: unknownId(),
      answers: [],
    });
    expect([submitTheirs.status, submitUnknown.status]).toEqual([404, 404]);
    expect(submitTheirs.body).toEqual(submitUnknown.body);
    const abandonTheirs = await b.post(
      `/modules/${m1.id}/quiz/sessions/${theirs.sessionId}/abandon`,
    );
    const abandonUnknown = await b.post(`/modules/${m1.id}/quiz/sessions/${unknownId()}/abandon`);
    expect([abandonTheirs.status, abandonUnknown.status]).toEqual([404, 404]);
    expect(abandonTheirs.body).toEqual(abandonUnknown.body);
    expect((await b.post(`/final-test/sessions/${theirs.sessionId}/abandon`)).status).toBe(403);

    // Nothing of theirs changed; my session is untouched; theirs still submits.
    expect(await sessionStatus(theirs.sessionId)).toBe('open');
    expect(await sessionStatus(mine.sessionId)).toBe('open');
    expect(await QuizAttempt.countDocuments({ userId: b.id })).toBe(0);
    expect((await submitQuiz(a, m2.id, theirs, c.keys, 5)).status).toBe(201);
  });

  it('ID2: starting my own session never closes the open session of another employee', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const a = await signedInEmployee(t.app, creds);
    const b = await signedInEmployee(t.app, creds);
    await completeContent(a, m1);
    await completeContent(b, m1);
    const { session: theirs } = await startQuiz(a, m1.id);
    for (let i = 0; i < 3; i += 1) expect((await startQuiz(b, m1.id)).res.status).toBe(201);
    expect(await sessionStatus(theirs.sessionId)).toBe('open');
    expect(await QuizAttempt.countDocuments({ userId: a.id })).toBe(0);
  });
});

// =================================================================================================
describe('SEC3-RC: races and partial failures', () => {
  it('RC1: at exactly expiresAt a submit is SESSION_EXPIRED and an abandon is recorded as expired', async () => {
    const t = await buildTestApp({ learning: { sessionTtlSeconds: 300 } });
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const ttlMs = t.config.learning.sessionTtlSeconds * 1000;

    const { session: s1 } = await startQuiz(emp, m1.id);
    t.advance(ttlMs);
    const late = await submitQuiz(emp, m1.id, s1, c.keys, 5);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('SESSION_EXPIRED');
    expect(await sessionStatus(s1.sessionId)).toBe('expired');

    const { session: s2 } = await startQuiz(emp, m1.id);
    t.advance(ttlMs);
    const ab = await emp.post(`/modules/${m1.id}/quiz/sessions/${s2.sessionId}/abandon`);
    expect(ab.status).toBe(201);
    expect(ab.body.endReason).toBe('expired');
    expect(await QuizAttempt.countDocuments({ passed: true })).toBe(0);
    expect((await UserProgress.findOne({ userId: emp.id }).lean())?.quizPassed).toBe(false);
  });

  it('RC2: a failed attempt insert returns the session; nothing is credited; a retry passes once', async () => {
    const hooks = spyHooks();
    const t = await buildTestApp({}, { learningHooks: hooks });
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);

    vi.spyOn(QuizAttempt, 'create').mockRejectedValueOnce(new Error('simulated write failure'));
    const broken = await submitQuiz(emp, m1.id, session, c.keys, 5);
    expect(broken.status).toBe(500);
    expect(await sessionStatus(session.sessionId)).toBe('open');
    expect(await QuizAttempt.countDocuments({})).toBe(0);
    const row = await UserProgress.findOne({ userId: emp.id }).lean();
    expect([row?.quizPassed, row?.attempts]).toEqual([false, 0]);
    expect(hooks.onAttemptRecorded).not.toHaveBeenCalled();

    vi.restoreAllMocks();
    const retry = await submitQuiz(emp, m1.id, session, c.keys, 5);
    expect(retry.status).toBe(201);
    expect(retry.body.passed).toBe(true);
    expect(await QuizAttempt.countDocuments({})).toBe(1);
    expect(hooks.onModuleCompleted).toHaveBeenCalledTimes(1);
  });

  it('RC3: a submit racing a new session start has exactly one outcome for the old session', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    const [submit] = await Promise.all([
      submitQuiz(emp, m1.id, session, c.keys, 5),
      emp.post(`/modules/${m1.id}/quiz/sessions`),
    ]);
    const attempts = await QuizAttempt.find({ sessionId: session.sessionId }).lean();
    expect(attempts).toHaveLength(1);
    expect(need(attempts[0]).endReason).toBe(submit.status === 201 ? 'submitted' : 'abandoned');
    expect(await AssessmentSession.countDocuments({ status: 'open' })).toBeLessThanOrEqual(1);
  });

  // P3-L1: writes are ordered, not transactional. If the progress update fails after the passing
  // attempt is inserted (crash, primary step-down, timeout), the employee gets a 500, the session is
  // consumed, the append-only history says "passed" (and the reveal policy treats the quiz as
  // passed), but UserProgress.quizPassed never learns of it and nothing reconciles it. The employee
  // must pass again and onModuleCompleted fires for a later attempt. ADR 0007 calls this "delays a
  // progress update", but no code path ever completes the delayed update.
  it('RC4 [P3-L1]: a pass recorded in the history is reflected in progression after a partial failure', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 2 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);

    const original = UserProgress.updateOne.bind(UserProgress) as (...a: unknown[]) => unknown;
    vi.spyOn(UserProgress, 'updateOne').mockImplementation(((
      filter: Record<string, unknown>,
      ...rest: unknown[]
    ) => {
      if (filter.quizPassed === false) throw new Error('simulated crash after insert');
      return original(filter, ...rest);
    }) as never);
    const res = await submitQuiz(emp, m1.id, session, c.keys, 5);
    vi.restoreAllMocks();

    expect(res.status).toBe(201); // adapted for P3-L1: a saved attempt is never reported as a 500
    expect(await QuizAttempt.countDocuments({ passed: true })).toBe(1); // the pass is committed
    const overview = await emp.get('/modules');
    expect(overview.body.modules[0].status).toBe('completed');
  });

  // P3-L2: "first pass" of the final test is decided by an exists() check made before the insert,
  // and attemptNumber by countDocuments() + 1. Neither is atomic. Submit does not re-check
  // ALREADY_PASSED, and a new session can be opened as soon as the old one is claimed, so while the
  // first insert is in flight a second passing submission also sees "no pass yet": the
  // exactly-once onFinalTestPassed hook (ADR 0008) fires twice and both attempts get the same
  // attemptNumber (Phase 4 plans to use attemptNumber === 1 as the Knowledge input).
  it('RC5 [P3-L2]: two racing final-test passes fire onFinalTestPassed once with distinct attempt numbers', async () => {
    const hooks = spyHooks();
    const t = await buildTestApp({}, { learningHooks: hooks });
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    await createFinalTest(c.keys, 5);
    const emp = await signedInEmployee(t.app, creds);
    await passModule(emp, m1, c.keys);
    const a = (await emp.post('/final-test/sessions')).body as AssessmentSessionDTO;

    // Simulated latency on the first attempt insert only (a slow primary, a GC pause).
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const create = QuizAttempt.create.bind(QuizAttempt) as (...x: unknown[]) => Promise<unknown>;
    let calls = 0;
    vi.spyOn(QuizAttempt, 'create').mockImplementation((async (...args: unknown[]) => {
      calls += 1;
      if (calls === 1) await gate;
      return create(...args);
    }) as never);

    const first = emp
      .post('/final-test/attempts', { sessionId: a.sessionId, answers: answersFor(a, c.keys, 5) })
      .then((r) => r);
    try {
      await waitFor(async () => (await sessionStatus(a.sessionId)) === 'submitted');
      const startB = await emp.post('/final-test/sessions');
      expect(startB.status).toBe(201);
      const b = startB.body as AssessmentSessionDTO;
      const second = await emp.post('/final-test/attempts', {
        sessionId: b.sessionId,
        answers: answersFor(b, c.keys, 5),
      });
      expect(second.status).toBe(201);
    } finally {
      release();
    }
    expect((await first).status).toBe(201);

    const numbers = (await QuizAttempt.find({ type: 'FinalTest' }).lean()).map(
      (x) => x.attemptNumber,
    );
    expect(hooks.onFinalTestPassed).toHaveBeenCalledTimes(1);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  // P3-L3: "at most one open session" rests only on the partial unique index, which Mongoose
  // autoIndex builds in the background and nothing verifies. If it is missing (autoIndex off in
  // production, a failed build, a manual drop), concurrent starts open several sessions, each of
  // which can be submitted. Same class as P2-L5.
  it('RC6 [P3-L3]: concurrent starts leave one open session even without the partial index', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    await AssessmentSession.collection.dropIndex('one_open_session');
    try {
      await Promise.all(
        Array.from({ length: 6 }, () => emp.post(`/modules/${m1.id}/quiz/sessions`)),
      );
      expect(
        await AssessmentSession.countDocuments({ userId: emp.id, status: 'open' }),
      ).toBeLessThanOrEqual(1);
    } finally {
      // The duplicates left behind would also make the rebuild fail (E11000), which is the
      // production failure mode: once two open sessions exist the guard cannot come back.
      await AssessmentSession.collection.deleteMany({});
      await AssessmentSession.syncIndexes();
    }
  });
});

// =================================================================================================
describe('SEC3-AO: QuizAttempt is append-only', () => {
  it('AO1: every Mongoose mutation path is blocked (same depth as AuditLog AL3)', async () => {
    await QuizAttempt.init();
    const doc = await QuizAttempt.create(sampleAttempt());
    const id = doc._id;
    const original = JSON.stringify(await QuizAttempt.collection.findOne({ _id: id }));
    const load = async () => {
      const d = await QuizAttempt.findById(id);
      if (!d) throw new Error('missing');
      return d;
    };
    const forge = { passed: true, score: 100 };
    const ops: [string, () => Promise<unknown>][] = [
      [
        'bulkSave',
        async () => {
          const d = await load();
          d.passed = true;
          return QuizAttempt.bulkSave([d]);
        },
      ],
      [
        'hydrate then save',
        async () => {
          const d = QuizAttempt.hydrate(await QuizAttempt.collection.findOne({ _id: id }));
          d.set('passed', true);
          return d.save();
        },
      ],
      [
        'isNew forced then save',
        async () => {
          const d = await load();
          d.isNew = true;
          d.passed = true;
          return d.save();
        },
      ],
      ['doc.updateOne', async () => (await load()).updateOne(forge)],
      ['doc.deleteOne', async () => (await load()).deleteOne()],
      ['updateOne', () => QuizAttempt.updateOne({ _id: id }, forge).exec()],
      ['updateMany', () => QuizAttempt.updateMany({}, forge).exec()],
      ['findByIdAndUpdate', () => QuizAttempt.findByIdAndUpdate(id, forge).exec()],
      ['upsert', () => QuizAttempt.findOneAndUpdate({ _id: id }, forge, { upsert: true }).exec()],
      [
        'replaceOne',
        () => QuizAttempt.replaceOne({ _id: id }, { ...sampleAttempt(), ...forge }).exec(),
      ],
      [
        'findOneAndReplace',
        () => QuizAttempt.findOneAndReplace({ _id: id }, { ...sampleAttempt(), ...forge }).exec(),
      ],
      ['query chain updateOne', () => QuizAttempt.find({ _id: id }).updateOne({}, forge).exec()],
      ['query chain deleteOne', () => QuizAttempt.where({ _id: id }).deleteOne().exec()],
      ['deleteOne', () => QuizAttempt.deleteOne({ _id: id }).exec()],
      ['deleteMany', () => QuizAttempt.deleteMany({}).exec()],
      ['findByIdAndDelete', () => QuizAttempt.findByIdAndDelete(id).exec()],
      [
        'pipeline update',
        () =>
          QuizAttempt.updateOne({ _id: id }, [{ $set: forge }], { updatePipeline: true }).exec(),
      ],
      [
        'bulkWrite updateOne',
        () => QuizAttempt.bulkWrite([{ updateOne: { filter: { _id: id }, update: forge } }]),
      ],
      ['bulkWrite deleteMany', () => QuizAttempt.bulkWrite([{ deleteMany: { filter: {} } }])],
      ['insertMany same _id', () => QuizAttempt.insertMany([{ ...sampleAttempt(), _id: id }])],
    ];
    for (const [name, op] of ops) {
      const err: unknown = await Promise.resolve()
        .then(op)
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(err, `${name} must be rejected`).not.toBeNull();
      expect(['QUIZ_ATTEMPT_IMMUTABLE', 11000], name).toContain((err as { code?: unknown }).code);
    }
    expect(await QuizAttempt.countDocuments()).toBe(1);
    expect(JSON.stringify(await QuizAttempt.collection.findOne({ _id: id }))).toBe(original);
  });

  // P3-L4: the plugin hooks every update/replace/delete path but not aggregation. An aggregate with
  // `$merge` (or `$out`) into `quizattempts`, issued through the QuizAttempt model, rewrites stored
  // attempts (forged passes, changed scores). The same gap exists on AuditLog (Phase 2).
  it('AO2 [P3-L4]: an aggregation with $merge cannot rewrite a stored attempt', async () => {
    const doc = await QuizAttempt.create(sampleAttempt());
    await QuizAttempt.aggregate([
      { $match: { _id: doc._id } },
      { $set: { passed: true, score: 100 } },
      {
        $merge: {
          into: 'quizattempts',
          on: '_id',
          whenMatched: 'replace',
          whenNotMatched: 'discard',
        },
      },
    ])
      .exec()
      .catch(() => undefined);
    const raw = await QuizAttempt.collection.findOne({ _id: doc._id });
    expect([raw?.passed, raw?.score]).toEqual([false, 0]);
  });
});

// =================================================================================================
describe('SEC3-HK: hooks seam', () => {
  it('HK1: hook output cannot change grading or add fields; only whitelisted effects appear', async () => {
    const hooks = {
      ...spyHooks(),
      onAttemptRecorded: vi.fn(() =>
        Promise.resolve({
          xpEarned: 5,
          badge: { id: 'b1', name: 'Badge', iconMotif: 'shield', correctIndex: 1 },
          passed: true,
          score: 100,
          review: [{ correctIndex: 0 }],
        } as never),
      ),
    };
    const t = await buildTestApp({}, { learningHooks: hooks });
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    const res = await submitQuiz(emp, m1.id, session, c.keys, 1);
    expect(res.status).toBe(201);
    expect(() => attemptResultSchema.parse(res.body)).not.toThrow();
    expect([res.body.passed, res.body.score]).toEqual([false, 20]);
    expect(res.body.effects).toEqual({
      xpEarned: 5,
      badge: { id: 'b1', name: 'Badge', iconMotif: 'shield' },
    });
    expect(scanForKeys(res.body).filter((p) => !p.endsWith('.explanation'))).toEqual([]);
    expect((await UserProgress.findOne({ userId: emp.id }).lean())?.quizPassed).toBe(false);
  });

  it('HK2: a hook error message never reaches the response', async () => {
    const secret = 'HOOK-SECRET-mongodb://admin:pw@db';
    const hooks = {
      ...spyHooks(),
      onModuleCompleted: vi.fn(() => Promise.reject(new Error(secret))),
    };
    const t = await buildTestApp({}, { learningHooks: hooks });
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    const res = await passModule(emp, m1, c.keys);
    expect(JSON.stringify(res.body)).not.toContain('HOOK-SECRET');
    expect(res.body.effects).toEqual({});
  });

  // P3-L5: hooks are awaited inline with no timeout. A slow or hung Phase 4 hook (risk engine, a
  // badge write, an audit outbox) holds the submit response open indefinitely although the attempt
  // is already committed; the kiosk shows a spinner and a retry gets SESSION_CLOSED.
  it('HK3 [P3-L5]: a hung hook does not hold the submit response', async () => {
    let release: () => void = () => undefined;
    const hung = new Promise<undefined>((resolve) => {
      release = () => {
        resolve(undefined);
      };
    });
    const hooks = { ...spyHooks(), onAttemptRecorded: vi.fn(() => hung) };
    const t = await buildTestApp({}, { learningHooks: hooks });
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    const pending = submitQuiz(emp, m1.id, session, c.keys, 5).then((r) => r);
    try {
      const winner = await Promise.race([
        pending.then(() => 'response'),
        sleep(3000).then(() => 'timeout'),
      ]);
      expect(winner).toBe('response');
    } finally {
      release();
      await pending;
    }
  });
});

// =================================================================================================
describe('SEC3-DS: resource bounds', () => {
  it('DS1: oversized answer arrays and bodies are refused before grading', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const { session } = await startQuiz(emp, m1.id);
    const path = `/modules/${m1.id}/quiz/attempts`;
    const many = (n: number) =>
      Array.from({ length: n }, () => ({ questionId: unknownId(), selectedIndex: 0 }));
    const tooMany = await emp.post(path, { sessionId: session.sessionId, answers: many(101) });
    expect(tooMany.status).toBe(400);
    const hundred = await emp.post(path, { sessionId: session.sessionId, answers: many(100) });
    expect(hundred.status).toBe(400);
    expect(hundred.body.error.details.issues).toHaveLength(100);
    const huge = await emp.post(path, {
      sessionId: session.sessionId,
      answers: [],
      pad: 'x'.repeat(200_000),
    });
    expect(huge.status).toBe(413);
    expect(await sessionStatus(session.sessionId)).toBe('open');
    expect((await emp.get('/me/attempts?limit=100')).status).toBe(200);
    expect((await emp.get('/me/attempts?limit=101')).status).toBe(400);
  });

  // P3-L6: every session start closes the previous one and writes an append-only "abandoned"
  // attempt, with no per-employee throttle. Only the global per-IP limiter (default 1000 / 15 min)
  // applies: one employee can add ~96k undeletable attempts a day, and loadLearningState runs an
  // unbounded $group over the caller's final-test attempts on every learning request.
  it('DS2 [P3-L6]: a burst of session starts by one employee is throttled', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const emp = await signedInEmployee(t.app, creds);
    await completeContent(emp, m1);
    const statuses: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      statuses.push((await emp.post(`/modules/${m1.id}/quiz/sessions`)).status);
    }
    // Adapted for P3-L6: the throttle stops the churn, so fewer attempts are recorded than starts.
    const created = statuses.filter((s) => s === 201).length;
    expect(await QuizAttempt.countDocuments({ userId: emp.id })).toBe(created - 1);
    expect(created).toBeLessThan(25);
    expect(statuses.some((s) => s === 429)).toBe(true);
  });
});

// =================================================================================================
describe('SEC3-SD: seed script and content integrity', () => {
  it('SD1: a full employee journey never writes modules or assessments', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 2, interactive: [2] });
    await createFinalTest(c.keys, 5);
    const snapshot = async () =>
      JSON.stringify([
        await Module.collection.find({}).sort({ _id: 1 }).toArray(),
        await Assessment.collection.find({}).sort({ _id: 1 }).toArray(),
      ]);
    const before = await snapshot();
    const emp = await signedInEmployee(t.app, creds);
    for (const m of c.modules) await passModule(emp, m, c.keys);
    const s = (await emp.post('/final-test/sessions')).body as AssessmentSessionDTO;
    const final = await emp.post('/final-test/attempts', {
      sessionId: s.sessionId,
      answers: answersFor(s, c.keys, 5),
    });
    expect(final.status).toBe(201);
    expect(await snapshot()).toBe(before);
  });

  it('SD2: an administrator token cannot drive the employee learning routes', async () => {
    const t = await buildTestApp();
    const c = await createCurriculum({ count: 1 });
    const m1 = need(c.modules[0]);
    const admin = await createAdmin(creds);
    const { accessToken } = await loginOk(t.app, admin);
    const adm = clientFor(t.app, admin, accessToken);
    for (const res of [
      await adm.get('/modules'),
      await adm.post(`/modules/${m1.id}/start`),
      await adm.post(`/modules/${m1.id}/quiz/sessions`),
      await adm.get('/me/attempts'),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect(await UserProgress.countDocuments({})).toBe(0);
  });

  // P3-L7: the seed production guard fails open. NODE_ENV defaults to 'development' when unset,
  // and `--reset` then deletes every module, assessment, progress row and append-only attempt
  // through the raw driver, with no confirmation, no host check and no audit entry. The script
  // ships in the production build (`npm run seed:learning`).
  it('SD3 [P3-L7]: --reset with NODE_ENV unset refuses to wipe the attempt history', async () => {
    await QuizAttempt.create(sampleAttempt(true));
    const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');
    const script = fileURLToPath(new URL('../src/scripts/seedLearning.ts', import.meta.url));
    const { host, port, name } = mongoose.connection;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      MONGODB_URI: `mongodb://${host}:${String(port)}/${name}`,
    };
    delete env.NODE_ENV;
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, [tsxCli, script, '--reset'], {
        cwd: tmpdir(),
        env,
        stdio: 'ignore',
      });
      child.on('error', reject);
      child.on('exit', resolve);
    });
    expect({ code, attempts: await QuizAttempt.collection.countDocuments() }).toEqual({
      code: 1,
      attempts: 1,
    });
  }, 90_000);
});
