import type { Express } from 'express';
import request from 'supertest';
import { expect, vi } from 'vitest';
import type { AssessmentSessionDTO } from '@csense/shared';
import type { LearningHooks } from '../../src/features/learning/learningHooks.js';
import {
  Assessment,
  AssessmentSession,
  FinalTest,
  Module,
  Quiz,
  QuizAttempt,
  UserProgress,
} from '../../src/models/index.js';
import { bearer, createEmployee, loginOk } from './fixtures.js';

export interface TestModule {
  id: string;
  order: number;
  quizId: string;
  questionIds: string[];
  exerciseIds: string[];
}

export interface TestCurriculum {
  modules: TestModule[];
  /** questionId -> correct option index, for every quiz question created. */
  keys: Map<string, number>;
}

export interface CurriculumOptions {
  count?: number;
  /** 1-based positions that are interactive (two exercises each). Others are plain video. */
  interactive?: number[];
  /** One value for all, or one per module. */
  passingScore?: number | number[];
  /** Per module; defaults to published. */
  published?: boolean[];
  /** Pool size per quiz. */
  questions?: number;
  /** Questions served per session; omitted serves the whole pool. */
  questionsPerSession?: number;
}

const OPTIONS = ['Option A', 'Option B', 'Option C', 'Option D'];

/** Creates published modules with a quiz each, straight in the database (the seed has its own test). */
export async function createCurriculum(opts: CurriculumOptions = {}): Promise<TestCurriculum> {
  const count = opts.count ?? 3;
  const perQuiz = opts.questions ?? 5;
  const keys = new Map<string, number>();
  const modules: TestModule[] = [];

  for (let n = 1; n <= count; n += 1) {
    const interactive = opts.interactive?.includes(n) ?? false;
    const published = opts.published?.[n - 1] ?? true;
    const passingScore = Array.isArray(opts.passingScore)
      ? (opts.passingScore[n - 1] ?? 70)
      : (opts.passingScore ?? 70);

    const mod = await Module.create({
      order: n,
      title: `Module ${String(n)}`,
      description: `Description ${String(n)}`,
      content: `Lesson text ${String(n)}`,
      format: interactive ? 'interactive' : 'video',
      duration: 5 + n,
      isPublished: published,
      ...(interactive
        ? {}
        : {
            videoUrl: `https://media.example.com/m${String(n)}.mp4`,
            captionsUrl: `https://media.example.com/m${String(n)}.vtt`,
            transcript: [{ startSeconds: 0, text: 'Welcome.' }],
          }),
      keyTakeaways: ['Remember this'],
      exercises: interactive
        ? [0, 1].map((i) => ({
            prompt: `Exercise ${String(n)}.${String(i)}`,
            options: ['Yes', 'No'],
            correctAnswer: i,
            explanation: `Exercise explanation ${String(n)}.${String(i)}`,
          }))
        : [],
    });
    const stored = await Module.findById(mod._id)
      .select('+exercises.correctAnswer')
      .lean<{ exercises: { exerciseId: { toHexString(): string } }[] }>();

    const quiz = await Quiz.create({
      title: `Quiz ${String(n)}`,
      moduleId: mod._id,
      passingScore,
      ...(opts.questionsPerSession === undefined
        ? {}
        : { questionsPerSession: opts.questionsPerSession }),
      questions: Array.from({ length: perQuiz }, (_, i) => ({
        text: `Question ${String(n)}.${String(i)}`,
        options: OPTIONS,
        correctAnswer: (i + n) % OPTIONS.length,
        explanation: `Why ${String(n)}.${String(i)}`,
      })),
    });
    const stored2 = await loadKeys(quiz.id);
    for (const [q, k] of stored2) keys.set(q, k);

    modules.push({
      id: mod.id,
      order: n,
      quizId: quiz.id,
      questionIds: [...stored2.keys()],
      exerciseIds: (stored?.exercises ?? []).map((e) => e.exerciseId.toHexString()),
    });
  }
  return { modules, keys };
}

/** Reads the answer keys straight from the database (tests only). */
export async function loadKeys(assessmentId: string): Promise<Map<string, number>> {
  const doc = await Assessment.findById(assessmentId)
    .select('+questions.correctAnswer')
    .lean<{ questions: { questionId: { toHexString(): string }; correctAnswer: number }[] }>();
  return new Map((doc?.questions ?? []).map((q) => [q.questionId.toHexString(), q.correctAnswer]));
}

export async function createFinalTest(
  keys: Map<string, number>,
  count = 15,
  passingScore = 70,
  questionsPerSession?: number,
): Promise<{ id: string; questionIds: string[] }> {
  const ft = await FinalTest.create({
    title: 'Final assessment',
    passingScore,
    ...(questionsPerSession === undefined ? {} : { questionsPerSession }),
    questions: Array.from({ length: count }, (_, i) => ({
      text: `Final question ${String(i)}`,
      options: OPTIONS,
      correctAnswer: i % OPTIONS.length,
      explanation: `Final why ${String(i)}`,
    })),
  });
  const final = await loadKeys(ft.id);
  for (const [q, k] of final) keys.set(q, k);
  return { id: ft.id, questionIds: [...final.keys()] };
}

export interface Client {
  id: string;
  email: string;
  token: string;
  get: (path: string) => request.Test;
  post: (path: string, body?: object) => request.Test;
  patch: (path: string, body?: object) => request.Test;
  put: (path: string, body?: object) => request.Test;
}

export function clientFor(
  app: Express,
  user: { id: string; email: string },
  token: string,
): Client {
  const url = (p: string): string => `/api/v1${p}`;
  return {
    id: user.id,
    email: user.email,
    token,
    get: (p) =>
      request(app)
        .get(url(p))
        .set(...bearer(token)),
    post: (p, body = {}) =>
      request(app)
        .post(url(p))
        .set(...bearer(token))
        .send(body),
    patch: (p, body = {}) =>
      request(app)
        .patch(url(p))
        .set(...bearer(token))
        .send(body),
    put: (p, body = {}) =>
      request(app)
        .put(url(p))
        .set(...bearer(token))
        .send(body),
  };
}

export async function signedInEmployee(
  app: Express,
  creds: { password: string; hash: string },
): Promise<Client> {
  const user = await createEmployee(creds);
  const { accessToken } = await loginOk(app, user);
  return clientFor(app, user, accessToken);
}

/** Answers where the first `correct` served questions are right and the rest deliberately wrong. */
export function answersFor(
  session: Pick<AssessmentSessionDTO, 'questions'>,
  keys: Map<string, number>,
  correct: number,
): { questionId: string; selectedIndex: number }[] {
  return session.questions.map((q, i) => {
    const key = keys.get(q.questionId);
    if (key === undefined) throw new Error('unknown question in fixture');
    return {
      questionId: q.questionId,
      selectedIndex: i < correct ? key : (key + 1) % q.options.length,
    };
  });
}

/** Start, answer every exercise and report the lesson finished. */
export async function completeContent(c: Client, mod: TestModule): Promise<void> {
  expect((await c.post(`/modules/${mod.id}/start`)).status).toBe(200);
  for (const exerciseId of mod.exerciseIds) {
    const res = await c.post(`/modules/${mod.id}/exercises/${exerciseId}/answers`, {
      selectedIndex: 0,
    });
    expect(res.status).toBe(200);
  }
  expect((await c.post(`/modules/${mod.id}/content/complete`)).status).toBe(200);
}

export async function startQuiz(c: Client, moduleId: string) {
  const res = await c.post(`/modules/${moduleId}/quiz/sessions`);
  return { res, session: res.body as AssessmentSessionDTO };
}

export async function submitQuiz(
  c: Client,
  moduleId: string,
  session: AssessmentSessionDTO,
  keys: Map<string, number>,
  correct: number,
) {
  return c.post(`/modules/${moduleId}/quiz/attempts`, {
    sessionId: session.sessionId,
    answers: answersFor(session, keys, correct),
  });
}

/** Content, session and an all-correct submission. Returns the attempt result. */
export async function passModule(c: Client, mod: TestModule, keys: Map<string, number>) {
  await completeContent(c, mod);
  const { res, session } = await startQuiz(c, mod.id);
  expect(res.status).toBe(201);
  const result = await submitQuiz(c, mod.id, session, keys, session.questions.length);
  expect(result.status).toBe(201);
  expect(result.body.passed).toBe(true);
  return result;
}

export async function failModule(
  c: Client,
  mod: TestModule,
  keys: Map<string, number>,
  correct = 2,
) {
  await completeContent(c, mod);
  const { res, session } = await startQuiz(c, mod.id);
  expect(res.status).toBe(201);
  const result = await submitQuiz(c, mod.id, session, keys, correct);
  expect(result.status).toBe(201);
  expect(result.body.passed).toBe(false);
  return result;
}

const FORBIDDEN_KEYS = new Set(['correctAnswer', 'correctIndex', 'explanation']);

/** Paths of every answer-key field anywhere in a response body (whole-response leak scan). */
export function scanForKeys(body: unknown, path = '$'): string[] {
  if (Array.isArray(body)) {
    return body.flatMap((v, i) => scanForKeys(v, `${path}[${String(i)}]`));
  }
  if (typeof body === 'object' && body !== null) {
    return Object.entries(body).flatMap(([k, v]) => [
      ...(FORBIDDEN_KEYS.has(k) ? [`${path}.${k}`] : []),
      ...scanForKeys(v, `${path}.${k}`),
    ]);
  }
  return [];
}

/** Spy hooks that return no effects. */
export function spyHooks() {
  const hooks = {
    onAttemptRecorded: vi.fn((): Promise<undefined> => Promise.resolve(undefined)),
    onModuleCompleted: vi.fn((): Promise<undefined> => Promise.resolve(undefined)),
    onFinalTestPassed: vi.fn((): Promise<undefined> => Promise.resolve(undefined)),
  };
  return hooks satisfies LearningHooks;
}

/** Unique and partial-unique indexes must exist before tests rely on them. */
export async function syncLearningIndexes(): Promise<void> {
  await Promise.all(
    [UserProgress, QuizAttempt, AssessmentSession, Assessment, Module].map((m) => m.syncIndexes()),
  );
}
