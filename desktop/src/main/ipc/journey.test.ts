import { afterEach, describe, expect, it, vi } from 'vitest';
import { declaredMethodKeys, IPC_CHANNEL_NAMES } from '../../shared/ipc';
import { jsonReply, recordingLogger } from '../testing/fakes';
import { toReleased } from '../testing/helpers';
import {
  OID,
  attemptDto,
  loginOnboarding,
  makeWorld,
  sessionDto,
  type World,
} from '../testing/world';
import { buildHandlers } from './handlers';
import { IPC_CHANNEL_POLICY } from './policy';
import { IpcRegistry, type IpcMainLike } from './registry';

afterEach(() => {
  loginOnboarding.value = undefined;
});

const resolveMedia = vi.fn((url: string | null | undefined) =>
  url === 'https://media.example.com/csense/placeholder/m1.mp4'
    ? 'app://csense/media/placeholder-lesson.webm'
    : null,
);

function wire(w: World) {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (c, l) => handlers.set(c, l), removeHandler: () => undefined };
  const registry = new IpcRegistry({ ipc, log: recordingLogger(), validateSender: () => true });
  registry.register(
    buildHandlers({
      config: w.config,
      api: w.api,
      session: w.session,
      gate: w.gate,
      lockdown: w.lockdown,
      reminders: { noteCooldown: vi.fn(), noteLearningActivity: vi.fn() },
      resolveMedia,
    }),
    IPC_CHANNEL_NAMES,
  );
  return (key: string, ...args: unknown[]) =>
    handlers.get(`csense:v1:${key}`)?.({}, ...args) as Promise<unknown>;
}

const progress = {
  moduleId: OID.module1,
  status: 'in_progress',
  startedAt: '2026-11-10T09:00:00.000Z',
  contentCompletedAt: null,
  exerciseAnswers: [],
};
const quiz = {
  quizId: OID.q1,
  moduleId: OID.module1,
  title: 'Quiz',
  questionCount: 5,
  passingScore: 70,
  attempts: 0,
  nextAttemptNumber: 1,
  bestScore: null,
  passed: false,
  canStart: true,
  blockedReason: null,
  cooldownUntil: null,
};
const summary = {
  id: OID.module1,
  position: 1,
  title: 'Phishing',
  description: 'd',
  format: 'video',
  durationMinutes: 5,
  status: 'in_progress',
  lockedBy: null,
  attempts: 0,
  bestScore: null,
  passed: false,
  completedAt: null,
};
const detail = {
  module: summary,
  content: {
    body: 'Body',
    keyTakeaways: ['One'],
    video: {
      url: 'https://media.example.com/csense/placeholder/m1.mp4',
      captionsUrl: 'https://media.example.com/csense/placeholder/m1.vtt',
      transcript: [{ id: 0, startSeconds: 0, text: 'Hello' }],
    },
    exercises: [],
  },
  progress,
  quiz,
};

const INPUTS: Record<string, unknown> = {
  'learning.getQuizOverview': { moduleId: OID.module1 },
  'learning.getModule': { moduleId: OID.module1 },
  'learning.startModule': { moduleId: OID.module1 },
  'learning.answerExercise': { moduleId: OID.module1, exerciseId: OID.q2, selectedIndex: 0 },
  'learning.completeContent': { moduleId: OID.module1 },
  'me.completeOnboarding': { outcome: 'completed' },
  'session.login': { email: 'a@b.co', password: 'x' },
  'assessment.exit': { sessionId: OID.session1 },
  'assessment.submit': { sessionId: OID.session1, answers: [] },
  'assessment.startSecure': { kind: 'final' },
  'gate.submitAnswer': { challengeId: OID.q1, optionIndex: 0 },
};

describe('POL4: policy table is enforced by the handlers', () => {
  const journeyKeys = declaredMethodKeys().filter(
    (k) => IPC_CHANNEL_POLICY[k as keyof typeof IPC_CHANNEL_POLICY].requiresRelease,
  );

  it('covers all ten learning/me channels', () => {
    expect(journeyKeys).toHaveLength(10);
  });

  it('every release-gated channel returns GATE_LOCKED before release and sends no request', async () => {
    const w = makeWorld();
    const call = wire(w);
    for (const key of journeyKeys) {
      expect(await call(key, INPUTS[key]), key).toMatchObject({
        ok: false,
        error: { code: 'GATE_LOCKED' },
      });
    }
    expect(w.fakeApi.requests).toHaveLength(0);
  });

  it('every closed-book channel returns LOCKDOWN_ACTIVE while a quiz is locked down', async () => {
    const w = makeWorld();
    await toReleased(w);
    w.fakeApi.on(`POST /modules/${OID.module1}/quiz/sessions`, jsonReply(201, sessionDto()));
    const call = wire(w);
    expect(
      await call('assessment.startSecure', { kind: 'quiz', moduleId: OID.module1 }),
    ).toMatchObject({ ok: true });
    expect(w.lockdown.isActive()).toBe(true);
    const before = w.fakeApi.requests.length;
    for (const key of journeyKeys) {
      expect(await call(key, INPUTS[key]), key).toMatchObject({
        ok: false,
        error: { code: 'LOCKDOWN_ACTIVE' },
      });
    }
    expect(w.fakeApi.requests).toHaveLength(before);
    // Assessment channels are unaffected by the closed-book rule.
    w.fakeApi.on(
      `POST /modules/${OID.module1}/quiz/attempts`,
      jsonReply(201, attemptDto('submitted', 100)),
    );
    expect(
      await call('assessment.submit', {
        sessionId: OID.session1,
        answers: [{ questionId: OID.q1, selectedIndex: 0 }],
      }),
    ).toMatchObject({ ok: true });
  });
});

describe('H1-H4: journey handlers', () => {
  it('getModule maps media through the resolver; no raw content URL reaches the renderer', async () => {
    const w = makeWorld();
    await toReleased(w);
    w.fakeApi.on(`GET /modules/${OID.module1}`, jsonReply(200, detail));
    const call = wire(w);
    const res = (await call('learning.getModule', { moduleId: OID.module1 })) as {
      ok: true;
      data: { content: { video: { src: string | null; captionsSrc: string | null } } };
    };
    expect(res.ok).toBe(true);
    expect(res.data.content.video.src).toBe('app://csense/media/placeholder-lesson.webm');
    expect(res.data.content.video.captionsSrc).toBeNull();
    expect(JSON.stringify(res)).not.toMatch(/https?:\/\//);
    expect(resolveMedia).toHaveBeenCalledWith(detail.content.video.url);
  });

  it('getModule keeps video null for interactive modules', async () => {
    const w = makeWorld();
    await toReleased(w);
    w.fakeApi.on(
      `GET /modules/${OID.module1}`,
      jsonReply(200, { ...detail, content: { ...detail.content, video: null } }),
    );
    const res = (await wire(w)('learning.getModule', { moduleId: OID.module1 })) as {
      data: { content: { video: unknown } };
    };
    expect(res.data.content.video).toBeNull();
  });

  it('startModule, answerExercise and completeContent post to the module routes', async () => {
    const w = makeWorld();
    await toReleased(w);
    w.fakeApi.on(`POST /modules/${OID.module1}/start`, jsonReply(200, progress));
    w.fakeApi.on(`POST /modules/${OID.module1}/exercises/${OID.q2}/answers`, (req) =>
      jsonReply(200, {
        exerciseId: OID.q2,
        selectedIndex: (req.body as { selectedIndex: number }).selectedIndex,
        correct: true,
        correctIndex: 0,
        explanation: 'Because.',
        recorded: true,
      }),
    );
    w.fakeApi.on(
      `POST /modules/${OID.module1}/content/complete`,
      jsonReply(200, { ...progress, contentCompletedAt: '2026-11-10T09:05:00.000Z' }),
    );
    const call = wire(w);
    expect(await call('learning.startModule', INPUTS['learning.startModule'])).toMatchObject({
      ok: true,
    });
    expect(await call('learning.answerExercise', INPUTS['learning.answerExercise'])).toMatchObject({
      ok: true,
      data: { correct: true, correctIndex: 0 },
    });
    expect(
      await call('learning.completeContent', INPUTS['learning.completeContent']),
    ).toMatchObject({ ok: true });
    expect(w.fakeApi.requests.find((r) => r.path.endsWith('/answers'))?.body).toEqual({
      selectedIndex: 0,
    });
  });

  it('a module response with a leaked key field becomes BAD_RESPONSE (strict schemas)', async () => {
    const w = makeWorld();
    await toReleased(w);
    w.fakeApi.on(
      `GET /modules/${OID.module1}`,
      jsonReply(200, {
        ...detail,
        content: {
          ...detail.content,
          exercises: [
            { exerciseId: OID.q2, prompt: 'p', artifact: null, options: ['a'], correctIndex: 0 },
          ],
        },
      }),
    );
    expect(await wire(w)('learning.getModule', { moduleId: OID.module1 })).toMatchObject({
      ok: false,
      error: { code: 'BAD_RESPONSE' },
    });
    w.fakeApi.on(`GET /modules/${OID.module1}/quiz`, jsonReply(200, { ...quiz, correctAnswer: 1 }));
    expect(await wire(w)('learning.getQuizOverview', { moduleId: OID.module1 })).toMatchObject({
      ok: false,
      error: { code: 'BAD_RESPONSE' },
    });
    w.fakeApi.on('GET /me/xp', jsonReply(200, { totalXP: 1, explanation: 'x' }));
    expect(await wire(w)('me.getXp')).toMatchObject({ ok: false, error: { code: 'BAD_RESPONSE' } });
  });

  it('H1: ACCESS_RESTRICTED from a journey call re-locks the workstation into the gate', async () => {
    const w = makeWorld();
    await toReleased(w);
    expect(w.gate.isReleased()).toBe(true);
    w.fakeApi.on(
      'GET /me/xp',
      jsonReply(403, { error: { code: 'ACCESS_RESTRICTED', message: 'x' } }),
    );
    w.fakeApi.on(
      'GET /gate/status',
      jsonReply(403, { error: { code: 'ACCESS_RESTRICTED', message: 'x' } }),
    );
    const res = await wire(w)('me.getXp');
    expect(res).toMatchObject({ ok: false, error: { code: 'ACCESS_RESTRICTED' } });
    for (let i = 0; i < 12; i++) await new Promise<void>((r) => setImmediate(r));
    expect(w.gate.isReleased()).toBe(false);
    expect(w.gate.getView().phase).toBe('restricted');
    expect(w.lock.state).toBe('gate');
  });

  it('H2: me.completeOnboarding clears onboardingRequired and emits a session event', async () => {
    loginOnboarding.value = null;
    const w = makeWorld();
    await toReleased(w);
    expect(w.session.getView().user?.onboardingRequired).toBe(true);
    w.fakeApi.on(
      'PATCH /me/onboarding',
      jsonReply(200, { outcome: 'completed', at: '2026-11-10T09:00:00.000Z' }),
    );
    const before = w.events.filter((e) => e.type === 'session').length;
    const res = await wire(w)('me.completeOnboarding', { outcome: 'completed' });
    expect(res).toMatchObject({ ok: true, data: { outcome: 'completed' } });
    expect(w.fakeApi.requests.at(-1)?.body).toEqual({ outcome: 'completed' });
    expect(w.session.getView().user?.onboardingRequired).toBeUndefined();
    expect(w.events.filter((e) => e.type === 'session').length).toBe(before + 1);
  });

  it('H3: a failed onboarding PATCH leaves the session view unchanged', async () => {
    loginOnboarding.value = null;
    const w = makeWorld();
    await toReleased(w);
    w.fakeApi.on('PATCH /me/onboarding', { status: 0, throws: true });
    const res = await wire(w)('me.completeOnboarding', { outcome: 'skipped' });
    expect(res).toMatchObject({ ok: false, error: { code: 'NETWORK_UNAVAILABLE' } });
    expect(w.session.getView().user?.onboardingRequired).toBe(true);
  });

  it('H4: onboarding is required only for employees with a null state', async () => {
    const w = makeWorld();
    loginOnboarding.value = { outcome: 'completed', at: '2026-11-10T09:00:00.000Z' };
    await toReleased(w);
    expect(w.session.getView().user?.onboardingRequired).toBeUndefined();
  });

  it('getFinalTestOverview returns the strict overview', async () => {
    const w = makeWorld();
    await toReleased(w);
    w.fakeApi.on('GET /final-test', jsonReply(404, { error: { code: 'NOT_FOUND', message: 'x' } }));
    expect(await wire(w)('learning.getFinalTestOverview')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});
