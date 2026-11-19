import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  IPC_CHANNELS_V1,
  IPC_CHANNEL_NAMES,
  IPC_EVENT_CHANNEL,
  IPC_INPUT_SCHEMAS,
  IPC_MAX_PAYLOAD_BYTES,
  channelFor,
  declaredMethodKeys,
} from '../../shared/ipc';
import { recordingLogger } from '../testing/fakes';
import { IPC_CHANNEL_POLICY, type ChannelPolicy } from './policy';
import { IpcRegistry, assertIpcRegistry, type IpcHandlers, type IpcMainLike } from './registry';

const OID = 'a'.repeat(24);

function fakeIpc(): IpcMainLike & {
  invoke: (key: string, event: unknown, ...args: unknown[]) => Promise<unknown>;
  channels: () => string[];
} {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  return {
    handle: (c, l) => handlers.set(c, l),
    removeHandler: (c) => handlers.delete(c),
    invoke: (key, event, ...args) => {
      const h = handlers.get(channelFor(key));
      if (!h) throw new Error(`no handler ${key}`);
      return Promise.resolve(h(event, ...args));
    },
    channels: () => [...handlers.keys()],
  };
}

const okSender = { good: true };
function allHandlers(fn: (k: string) => unknown = () => 'handled'): IpcHandlers {
  return Object.fromEntries(
    declaredMethodKeys().map((k) => [k, () => fn(k)]),
  ) as unknown as IpcHandlers;
}

function make(opts: { now?: () => number; schemas?: Record<string, z.ZodType> } = {}) {
  const ipc = fakeIpc();
  const log = recordingLogger();
  const registry = new IpcRegistry({
    ipc,
    log,
    validateSender: (e) => (e as { good?: boolean }).good === true,
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.schemas ? { schemas: opts.schemas } : {}),
  });
  return { ipc, log, registry };
}

describe('IPC1-IPC3: registry integrity', () => {
  it('registers exactly the declared channels and passes the assertion', () => {
    const { ipc, registry } = make();
    registry.register(allHandlers(), IPC_CHANNEL_NAMES);
    expect(ipc.channels().sort()).toEqual([...IPC_CHANNEL_NAMES].sort());
  });

  it('IPC8: the channel inventory is a reviewed snapshot (22 invoke channels + 1 event channel)', () => {
    expect(IPC_CHANNELS_V1).toMatchInlineSnapshot(`
      {
        "assessment": [
          "startSecure",
          "resume",
          "submit",
          "exit",
        ],
        "gate": [
          "getView",
          "requestChallenge",
          "submitAnswer",
          "continue",
          "continueOffline",
        ],
        "learning": [
          "getOverview",
          "getQuizOverview",
          "getModule",
          "startModule",
          "answerExercise",
          "completeContent",
          "getFinalTestOverview",
        ],
        "me": [
          "getXp",
          "getBadges",
          "completeOnboarding",
        ],
        "session": [
          "getState",
          "login",
          "logout",
        ],
      }
    `);
    expect(IPC_CHANNEL_NAMES).toHaveLength(22);
    expect(IPC_EVENT_CHANNEL).toBe('csense:v1:event');
    expect(Object.keys(IPC_INPUT_SCHEMAS).sort()).toEqual(declaredMethodKeys().sort());
  });

  it('IPC2: a channel without a schema refuses start-up', () => {
    const schemas = { ...IPC_INPUT_SCHEMAS } as Record<string, z.ZodType>;
    delete schemas['gate.continue'];
    const { registry } = make({ schemas });
    expect(() => {
      registry.register(allHandlers(), IPC_CHANNEL_NAMES);
    }).toThrow(/gate\.continue has no schema/);
  });

  it('a declared channel without a handler refuses start-up', () => {
    const { registry } = make();
    const handlers = allHandlers() as unknown as Record<string, unknown>;
    delete handlers['session.login'];
    expect(() => {
      registry.register(handlers, IPC_CHANNEL_NAMES);
    }).toThrow(/session\.login has no handler/);
  });

  it('IPC3: a preload channel list that differs from the registry refuses start-up', () => {
    const { registry } = make();
    expect(() => {
      registry.register(allHandlers(), [...IPC_CHANNEL_NAMES, 'csense:v1:app.exec']);
    }).toThrow(/preload channel list differs/);
    const { registry: r2 } = make();
    expect(() => {
      r2.register(allHandlers(), IPC_CHANNEL_NAMES.slice(1));
    }).toThrow(/preload channel list differs/);
  });

  it('assertIpcRegistry rejects duplicates and undeclared channels', () => {
    const keys = declaredMethodKeys();
    expect(() => {
      assertIpcRegistry([...keys, keys[0] as string], keys, IPC_CHANNEL_NAMES);
    }).toThrow(/duplicate/);
    expect(() => {
      assertIpcRegistry([...keys, 'x.y'], keys, IPC_CHANNEL_NAMES);
    }).toThrow(/undeclared/);
  });

  it('there is no generic passthrough channel', () => {
    for (const name of IPC_CHANNEL_NAMES) {
      expect(name).toMatch(/^csense:v1:(session|gate|assessment|learning|me)\.[a-zA-Z]+$/);
    }
    expect(IPC_CHANNEL_NAMES.some((n) => /invoke|call|request\b|exec|eval|fetch/i.test(n))).toBe(
      false,
    );
  });
});

describe('IPC4-IPC7: the invoke pipeline', () => {
  const start = (fn?: (k: string) => unknown, now?: () => number) => {
    const m = make(now ? { now } : {});
    m.registry.register(allHandlers(fn), IPC_CHANNEL_NAMES);
    return m;
  };

  it('IPC4: strict schemas reject extra fields, bad ids, oversize strings and bad types', async () => {
    const { ipc } = start();
    const bad: [string, unknown][] = [
      ['session.login', { email: 'a@b.co', password: 'x', extra: 1 }],
      ['session.login', { email: 'a'.repeat(255), password: 'x' }],
      ['session.login', { email: 'a@b.co', password: 'é'.repeat(37) }], // 74 UTF-8 bytes
      ['session.login', { email: 'a@b.co', password: '' }],
      ['session.login', 'a string'],
      ['gate.submitAnswer', { challengeId: 'not-an-id', optionIndex: 0 }],
      ['gate.submitAnswer', { challengeId: OID, optionIndex: -1 }],
      ['gate.submitAnswer', { challengeId: OID, optionIndex: 99 }],
      ['gate.submitAnswer', { challengeId: OID, optionIndex: 1.5 }],
      ['gate.submitAnswer', { challengeId: OID, optionIndex: 0, correct: true }],
      ['assessment.startSecure', { kind: 'quiz' }],
      ['assessment.startSecure', { kind: 'quiz', moduleId: 'zz' }],
      ['assessment.startSecure', { kind: 'final', moduleId: OID }],
      ['assessment.startSecure', { kind: 'other' }],
      ['assessment.exit', { sessionId: '../etc' }],
      ['assessment.submit', { sessionId: OID, answers: [], passed: true }],
      [
        'assessment.submit',
        { sessionId: OID, answers: [{ questionId: OID, selectedIndex: 0, correct: true }] },
      ],
      ['learning.getQuizOverview', { moduleId: OID, path: '/x' }],
      ['learning.getModule', { moduleId: OID, url: 'https://x' }],
      ['learning.startModule', { moduleId: 'nope' }],
      ['learning.answerExercise', { moduleId: OID, exerciseId: OID, selectedIndex: 6 }],
      [
        'learning.answerExercise',
        { moduleId: OID, exerciseId: OID, selectedIndex: 0, userId: OID },
      ],
      ['learning.completeContent', { moduleId: OID, force: true }],
      ['learning.getFinalTestOverview', { x: 1 }],
      ['me.getXp', 'x'],
      ['me.completeOnboarding', { outcome: 'done' }],
      ['me.completeOnboarding', { outcome: 'completed', at: 'now' }],
      ['me.completeOnboarding', {}],
      ['learning.getQuizOverview', { moduleId: 'abc' }],
      ['gate.continue', { anything: 1 }],
      ['session.getState', 'x'],
    ];
    for (const [key, input] of bad) {
      expect(
        await ipc.invoke(key, okSender, input),
        `${key} ${JSON.stringify(input)}`,
      ).toMatchObject({
        ok: false,
        error: { code: 'INVALID_INPUT' },
      });
    }
  });

  it('accepts valid input and normalises ids to lower case', async () => {
    const seen: unknown[] = [];
    const ipc = fakeIpc();
    const registry = new IpcRegistry({ ipc, log: recordingLogger(), validateSender: () => true });
    const handlers = allHandlers() as unknown as Record<string, (i: unknown) => unknown>;
    handlers['gate.submitAnswer'] = (i) => {
      seen.push(i);
      return { ok: true };
    };
    registry.register(handlers, IPC_CHANNEL_NAMES);
    await ipc.invoke('gate.submitAnswer', okSender, {
      challengeId: 'A'.repeat(24),
      optionIndex: 2,
    });
    expect(seen).toEqual([{ challengeId: 'a'.repeat(24), optionIndex: 2 }]);
  });

  it('IPC4b: enforces 50 answers max and rejects duplicate question ids', async () => {
    const { ipc } = start();
    const answers = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        questionId: i.toString(16).padStart(24, '0'),
        selectedIndex: 0,
      }));
    expect(
      await ipc.invoke('assessment.submit', okSender, { sessionId: OID, answers: answers(50) }),
    ).toBe('handled');
    expect(
      await ipc.invoke('assessment.submit', okSender, { sessionId: OID, answers: answers(51) }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    const dup = [answers(1)[0], answers(1)[0]];
    expect(
      await ipc.invoke('assessment.submit', okSender, { sessionId: OID, answers: dup }),
    ).toMatchObject({
      ok: false,
    });
  });

  it('IPC4c: a payload over 64 KB is rejected before parsing', async () => {
    const { ipc } = start();
    const res = await ipc.invoke('session.login', okSender, {
      email: 'a@b.co',
      password: 'x'.repeat(IPC_MAX_PAYLOAD_BYTES + 1),
    });
    expect(res).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('more than one argument is rejected', async () => {
    const { ipc } = start();
    expect(await ipc.invoke('gate.continue', okSender, undefined, 'extra')).toMatchObject({
      ok: false,
    });
  });

  it('IPC5: a foreign or subframe sender is refused with FORBIDDEN_SENDER and logged', async () => {
    const handler = vi.fn(() => 'handled');
    const { ipc, log } = start(handler);
    const res = await ipc.invoke('gate.continue', { good: false });
    expect(res).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN_SENDER', message: 'Request not allowed.' },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(log.events.some((e) => e.event === 'ipc.forbidden_sender')).toBe(true);
  });

  it('IPC6: a per-channel rate guard of 20 calls per second', async () => {
    let t = 1000;
    const { ipc } = start(undefined, () => t);
    for (let i = 0; i < 20; i++) expect(await ipc.invoke('gate.getView', okSender)).toBe('handled');
    expect(await ipc.invoke('gate.getView', okSender)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    // Other channels are unaffected, and the window slides.
    expect(await ipc.invoke('session.getState', okSender)).toBe('handled');
    t += 1001;
    expect(await ipc.invoke('gate.getView', okSender)).toBe('handled');
  });

  it('POL1: a channel without a policy row refuses start-up', () => {
    const policy = { ...IPC_CHANNEL_POLICY } as Record<string, ChannelPolicy>;
    delete policy['me.getXp'];
    const ipc = fakeIpc();
    const registry = new IpcRegistry({
      ipc,
      log: recordingLogger(),
      validateSender: () => true,
      policy,
    });
    expect(() => {
      registry.register(allHandlers(), IPC_CHANNEL_NAMES);
    }).toThrow(/me\.getXp has no policy/);
  });

  it('POL2: every declared channel has a policy row, and ceilings follow the plan (D6-10)', () => {
    expect(Object.keys(IPC_CHANNEL_POLICY).sort()).toEqual(declaredMethodKeys().sort());
    const rate = (k: keyof typeof IPC_CHANNEL_POLICY) => IPC_CHANNEL_POLICY[k].ratePerSecond;
    expect(rate('learning.answerExercise')).toBe(5);
    expect(rate('learning.startModule')).toBe(2);
    expect(rate('learning.completeContent')).toBe(2);
    expect(rate('me.completeOnboarding')).toBe(1);
    expect(rate('learning.getOverview')).toBe(20);
    expect(rate('me.getXp')).toBe(20);
    // Phase 5 channels keep their behaviour: never release-gated here, always allowed in lockdown.
    for (const k of declaredMethodKeys()) {
      const p = IPC_CHANNEL_POLICY[k as keyof typeof IPC_CHANNEL_POLICY];
      const journey = k.startsWith('learning.') || k.startsWith('me.');
      expect(p.requiresRelease, k).toBe(journey);
      expect(p.duringLockdown, k).toBe(journey ? 'deny' : 'allow');
    }
  });

  it('POL3: per-channel rate ceilings are enforced (6th exercise answer in one second refused)', async () => {
    let t = 5000;
    const { ipc } = start(undefined, () => t);
    const input = { moduleId: OID, exerciseId: OID, selectedIndex: 0 };
    for (let i = 0; i < 5; i++) {
      expect(await ipc.invoke('learning.answerExercise', okSender, input)).toBe('handled');
    }
    expect(await ipc.invoke('learning.answerExercise', okSender, input)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    expect(await ipc.invoke('me.completeOnboarding', okSender, { outcome: 'skipped' })).toBe(
      'handled',
    );
    expect(
      await ipc.invoke('me.completeOnboarding', okSender, { outcome: 'skipped' }),
    ).toMatchObject({ ok: false });
    t += 1001;
    expect(await ipc.invoke('learning.answerExercise', okSender, input)).toBe('handled');
  });

  it('IPC7: a handler that throws returns INTERNAL with no stack or message', async () => {
    const { ipc, log } = start((k) => {
      if (k === 'gate.continue') throw new Error('secret internals at C:\\src\\x.ts:12');
      return 'ok';
    });
    const res = (await ipc.invoke('gate.continue', okSender)) as { ok: boolean; error: unknown };
    expect(res).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'Unexpected error.' } });
    expect(JSON.stringify(res)).not.toMatch(/secret|stack|\.ts/);
    expect(JSON.stringify(log.events)).not.toContain('secret internals');
  });

  it('invalid input is logged by channel only, never by value (a password)', async () => {
    const { ipc, log } = start();
    await ipc.invoke('session.login', okSender, { email: 'a@b.co', password: 'hunter2', extra: 1 });
    expect(JSON.stringify(log.events)).not.toContain('hunter2');
  });

  it('dispose removes every handler', () => {
    const { ipc, registry } = make();
    registry.register(allHandlers(), IPC_CHANNEL_NAMES);
    registry.dispose();
    expect(ipc.channels()).toEqual([]);
  });
});
