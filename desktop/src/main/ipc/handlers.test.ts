import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNEL_NAMES } from '../../shared/ipc';
import { jsonReply, recordingLogger } from '../testing/fakes';
import { toReleased } from '../testing/helpers';
import {
  OID,
  challengeStatus,
  installAuthRoutes,
  makeWorld,
  sessionDto,
  type World,
} from '../testing/world';
import { buildHandlers } from './handlers';
import { IpcRegistry, type IpcMainLike } from './registry';

function wire(w: World, reminders = { noteCooldown: vi.fn(), noteLearningActivity: vi.fn() }) {
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
      reminders,
    }),
    IPC_CHANNEL_NAMES,
  );
  const call = (key: string, ...args: unknown[]) =>
    handlers.get(`csense:v1:${key}`)?.({}, ...args) as Promise<unknown>;
  return { call, reminders };
}

const overview = {
  modules: [],
  totalModules: 0,
  completedCount: 0,
  nextModuleId: null,
  finalTest: null,
};

describe('bridge handlers', () => {
  it('learning reads are refused while the gate is locked (GATE_LOCKED), without any request', async () => {
    const w = makeWorld();
    installAuthRoutes(w);
    w.fakeApi.on('GET /modules', jsonReply(200, overview));
    const { call } = wire(w);
    expect(await call('learning.getOverview')).toMatchObject({
      ok: false,
      error: { code: 'GATE_LOCKED' },
    });
    expect(await call('learning.getQuizOverview', { moduleId: OID.module1 })).toMatchObject({
      ok: false,
      error: { code: 'GATE_LOCKED' },
    });
    expect(w.fakeApi.count('GET /modules')).toBe(0);
  });

  it('learning reads work after release and note learning activity and cooldowns', async () => {
    const w = makeWorld();
    await toReleased(w);
    w.fakeApi.on('GET /modules', jsonReply(200, overview));
    const until = new Date(Date.now() + 60_000).toISOString();
    w.fakeApi.on(
      `GET /modules/${OID.module1}/quiz`,
      jsonReply(200, {
        quizId: OID.q1,
        moduleId: OID.module1,
        title: 'Quiz',
        questionCount: 5,
        passingScore: 70,
        attempts: 1,
        nextAttemptNumber: 2,
        bestScore: 40,
        passed: false,
        canStart: false,
        blockedReason: 'cooldown',
        cooldownUntil: until,
      }),
    );
    const { call, reminders } = wire(w);
    expect(await call('learning.getOverview')).toMatchObject({ ok: true });
    const q = await call('learning.getQuizOverview', { moduleId: OID.module1 });
    expect(q).toMatchObject({ ok: true, data: { cooldownUntil: until } });
    expect(reminders.noteLearningActivity).toHaveBeenCalled();
    expect(reminders.noteCooldown).toHaveBeenCalledWith(until);
  });

  it('a malformed server response never reaches the renderer', async () => {
    const w = makeWorld();
    await toReleased(w);
    w.fakeApi.on('GET /modules', jsonReply(200, { ...overview, refreshToken: 'x' }));
    const { call } = wire(w);
    expect(await call('learning.getOverview')).toMatchObject({
      ok: false,
      error: { code: 'BAD_RESPONSE' },
    });
  });

  it('session.login on a misconfigured build never calls the network', async () => {
    const w = makeWorld({ apiBaseUrl: null, configError: 'x' });
    const { call } = wire(w);
    expect(await call('session.login', { email: 'a@b.co', password: 'pw' })).toMatchObject({
      ok: false,
      error: { code: 'MISCONFIGURED' },
    });
    expect(w.fakeApi.requests).toHaveLength(0);
  });

  it('gate.continue through the bridge is refused before a server grant', async () => {
    const w = makeWorld();
    installAuthRoutes(w);
    await w.gate.start();
    const { call } = wire(w);
    expect(await call('gate.continue')).toMatchObject({
      ok: false,
      error: { code: 'GATE_LOCKED' },
    });
    expect(await call('gate.continueOffline')).toMatchObject({
      ok: false,
      error: { code: 'GATE_LOCKED' },
    });
    expect(w.lock.state).toBe('gate');
  });

  it('assessment.startSecure forwards a cooldown retryAt to the reminder scheduler', async () => {
    const w = makeWorld();
    await toReleased(w);
    w.fakeApi.on(`POST /modules/${OID.module1}/quiz/sessions`, {
      status: 409,
      body: {
        error: {
          code: 'ASSESSMENT_COOLDOWN',
          message: 'x',
          details: { retryAt: '2026-11-10T12:00:00.000Z' },
        },
      },
    });
    const { call, reminders } = wire(w);
    const res = await call('assessment.startSecure', { kind: 'quiz', moduleId: OID.module1 });
    expect(res).toMatchObject({ ok: false, error: { code: 'ASSESSMENT_COOLDOWN' } });
    expect(reminders.noteCooldown).toHaveBeenCalledWith('2026-11-10T12:00:00.000Z');
  });

  it('assessment.resume returns the cached session during lockdown and null otherwise', async () => {
    const w = makeWorld();
    await toReleased(w);
    w.fakeApi.on(`POST /modules/${OID.module1}/quiz/sessions`, jsonReply(201, sessionDto()));
    const { call } = wire(w);
    expect(await call('assessment.resume')).toBeNull();
    await call('assessment.startSecure', { kind: 'quiz', moduleId: OID.module1 });
    expect(await call('assessment.resume')).toMatchObject({ session: { sessionId: OID.session1 } });
  });

  it('P5-L2: session.login is refused unless the gate is waiting for credentials', async () => {
    const w = makeWorld();
    await toReleased(w);
    const { call } = wire(w);
    const before = w.fakeApi.count('POST /auth/login');
    expect(
      await call('session.login', { email: 'other@example.com', password: 'correct-password' }),
    ).toMatchObject({ ok: false, error: { code: 'GATE_LOCKED' } });
    expect(w.fakeApi.count('POST /auth/login')).toBe(before);
    expect(w.lock.state).toBe('unlocked');
  });

  it('session.login works on the Login step', async () => {
    const w = makeWorld();
    installAuthRoutes(w, { status: () => challengeStatus(3) });
    await w.gate.start();
    const { call } = wire(w);
    expect(
      await call('session.login', { email: 'user@example.com', password: 'correct-password' }),
    ).toMatchObject({ ok: true });
  });
});
