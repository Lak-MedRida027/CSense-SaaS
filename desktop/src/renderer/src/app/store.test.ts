import { describe, expect, it } from 'vitest';
import { createAppStore } from './store';
import {
  challengeView,
  createFakeBridge,
  gateView,
  sessionDto,
  signedInEmployee,
  signedOut,
} from './testing/fakeBridge';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('app store', () => {
  it('is not ready until the initial reads settle, then mirrors main', async () => {
    const fb = createFakeBridge({ session: signedInEmployee, gate: challengeView() });
    const store = createAppStore(fb.bridge);
    store.start();
    expect(store.getState().ready).toBe(false);
    await tick();
    expect(store.getState()).toMatchObject({
      ready: true,
      session: { status: 'signed_in' },
      gate: { phase: 'challenge' },
      appVersion: '0.0.0-test',
    });
  });

  it('an event that arrives before the initial read settles wins over that read', async () => {
    const fb = createFakeBridge({ session: signedOut, gate: gateView({ phase: 'signed_out' }) });
    const store = createAppStore(fb.bridge);
    store.start();
    fb.emit({ type: 'gate', view: challengeView() });
    await tick();
    expect(store.getState().gate?.phase).toBe('challenge');
  });

  it('start/stop are restartable (React StrictMode mounts effects twice)', async () => {
    const fb = createFakeBridge({ gate: challengeView() });
    const store = createAppStore(fb.bridge);
    store.start();
    store.stop();
    store.start();
    await tick();
    expect(store.getState().ready).toBe(true);
    fb.emit({ type: 'gate', view: gateView({ phase: 'released' }) });
    expect(store.getState().gate?.phase).toBe('released');
    store.stop();
    fb.emit({ type: 'gate', view: gateView({ phase: 'signed_out' }) });
    expect(store.getState().gate?.phase).toBe('released'); // no longer listening
  });

  it('tracks lockdown, clears stale warnings on a new lockdown, and counts navigate requests', async () => {
    const fb = createFakeBridge();
    const store = createAppStore(fb.bridge);
    store.start();
    await tick();
    fb.emit({ type: 'lockdown-violation', kind: 'focus_lost', count: 1, remaining: 2 });
    expect(store.getState().violation).toEqual({ kind: 'focus_lost', count: 1, remaining: 2 });
    fb.emit({ type: 'lockdown', state: 'entering', sessionId: null });
    expect(store.getState().violation).toBeNull();
    fb.emit({ type: 'lockdown', state: 'inactive', sessionId: 's1', reason: 'focus_lost' });
    expect(store.getState().lockdown).toEqual({
      state: 'inactive',
      sessionId: 's1',
      endReason: 'focus_lost',
    });
    fb.emit({ type: 'navigate', to: 'home' });
    expect(store.getState().homeRequests).toBe(1);
  });

  it('picks up a session main still holds (renderer crash recovery)', async () => {
    const resume = { session: sessionDto(), resumed: true, remainingFocusLosses: 2 };
    const fb = createFakeBridge({ resume });
    const store = createAppStore(fb.bridge);
    store.start();
    await tick();
    expect(store.getState().resume).toEqual(resume);
    expect(store.getState().lockdown.state).toBe('active');
    store.clearResume();
    expect(store.getState().resume).toBeNull();
  });

  it('a failing initial read still lets the UI render (boot state)', async () => {
    const fb = createFakeBridge();
    fb.mocks.resume.mockRejectedValue(new Error('ipc down'));
    const store = createAppStore(fb.bridge);
    store.start();
    await tick();
    expect(store.getState().ready).toBe(true);
    expect(store.getState().gate).toBeNull();
  });
});
