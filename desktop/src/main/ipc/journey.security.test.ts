/**
 * Security-tester regression tests for the Phase 6 bridge growth (plan 10, E6/E7/E11).
 * Tests marked `it.fails` document an unfixed finding: they assert the secure property and
 * currently fail. When the finding is fixed, vitest reports them and they become plain `it`.
 */
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNEL_NAMES } from '../../shared/ipc';
import { jsonReply, recordingLogger } from '../testing/fakes';
import { settle, toReleased } from '../testing/helpers';
import { OID, makeWorld, sessionDto, type World } from '../testing/world';
import { buildHandlers } from './handlers';
import { IpcRegistry, type IpcMainLike } from './registry';

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
      resolveMedia: () => null,
    }),
    IPC_CHANNEL_NAMES,
  );
  return (key: string, ...args: unknown[]) =>
    handlers.get(`csense:v1:${key}`)?.({}, ...args) as Promise<unknown>;
}

const summary = {
  id: OID.module1,
  position: 1,
  title: 'Phishing',
  description: 'd',
  format: 'interactive',
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
    body: 'SECRET LESSON BODY',
    keyTakeaways: ['One'],
    video: null,
    exercises: [],
  },
  progress: {
    moduleId: OID.module1,
    status: 'in_progress',
    startedAt: '2026-11-10T09:00:00.000Z',
    contentCompletedAt: null,
    exerciseAnswers: [],
  },
  quiz: null,
};

function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
}

describe('SEC-P6: closed-book and gate checks are time-of-check only', () => {
  it('P6-L1 (E6): a learning.getModule started before lockdown must not deliver content once lockdown is active', async () => {
    const w = makeWorld();
    await toReleased(w);
    const call = wire(w);
    const hold = deferred();
    w.fakeApi.on(`GET /modules/${OID.module1}`, () => ({
      ...jsonReply(200, detail),
      gate: hold.promise,
    }));
    w.fakeApi.on(`POST /modules/${OID.module1}/quiz/sessions`, jsonReply(201, sessionDto()));

    // Renderer: fire getModule, then immediately start the secure quiz.
    const pendingModule = call('learning.getModule', { moduleId: OID.module1 });
    await settle();
    const start = await call('assessment.startSecure', { kind: 'quiz', moduleId: OID.module1 });
    expect(start).toMatchObject({ ok: true });
    expect(w.lockdown.isActive()).toBe(true);

    hold.release();
    const res = await pendingModule;
    // Secure property: questions and module content never coexist in the renderer.
    expect(res).toMatchObject({ ok: false, error: { code: 'LOCKDOWN_ACTIVE' } });
  });

  it('P6-I1 (E11/E12): a journey response that arrives after sign-out must not be delivered', async () => {
    const w = makeWorld();
    await toReleased(w);
    const call = wire(w);
    const hold = deferred();
    w.fakeApi.on(`GET /modules/${OID.module1}`, () => ({
      ...jsonReply(200, detail),
      gate: hold.promise,
    }));
    w.fakeApi.on('POST /auth/logout', jsonReply(204));
    const pendingModule = call('learning.getModule', { moduleId: OID.module1 });
    await settle();
    await call('session.logout');
    await settle();
    expect(w.gate.isReleased()).toBe(false);
    hold.release();
    const res = await pendingModule;
    expect(res).toMatchObject({ ok: false, error: { code: 'GATE_LOCKED' } });
  });

  it('rate ceilings count refused calls (a flood cannot slip through between windows)', async () => {
    const w = makeWorld();
    await toReleased(w);
    const call = wire(w);
    w.fakeApi.on('PATCH /me/onboarding', jsonReply(200, { outcome: 'skipped', at: 'x' }));
    const results = await Promise.all(
      Array.from({ length: 5 }, () => call('me.completeOnboarding', { outcome: 'skipped' })),
    );
    expect(results.filter((r) => (r as { ok: boolean }).ok)).toHaveLength(1);
    expect(w.fakeApi.count('PATCH /me/onboarding')).toBe(1);
  });

  it('strict inputs: user ids, URLs, extra keys and prototype keys are refused before any request', async () => {
    const w = makeWorld();
    await toReleased(w);
    const call = wire(w);
    const before = w.fakeApi.requests.length;
    const bad: [string, unknown][] = [
      ['learning.getModule', { moduleId: OID.module1, userId: OID.module1 }],
      ['learning.getModule', { moduleId: '../admin/users' }],
      ['learning.getModule', { moduleId: `${OID.module1}/../../admin` }],
      ['learning.getModule', JSON.parse(`{"moduleId":"${OID.module1}","__proto__":{"x":1}}`)],
      ['learning.answerExercise', { moduleId: OID.module1, exerciseId: OID.q1, selectedIndex: -1 }],
      [
        'learning.answerExercise',
        { moduleId: OID.module1, exerciseId: OID.q1, selectedIndex: 1.5 },
      ],
      ['learning.answerExercise', { moduleId: OID.module1, exerciseId: OID.q1, selectedIndex: 99 }],
      ['me.completeOnboarding', { outcome: 'completed', at: '1970-01-01T00:00:00Z' }],
      ['me.completeOnboarding', { outcome: 'reset' }],
      ['me.completeOnboarding', null],
      ['me.getXp', { userId: OID.module1 }],
      ['learning.getOverview', 'x'],
    ];
    for (const [key, input] of bad) {
      expect(await call(key, input), key).toMatchObject({
        ok: false,
        error: { code: 'INVALID_INPUT' },
      });
    }
    expect(w.fakeApi.requests).toHaveLength(before);
  });
});
