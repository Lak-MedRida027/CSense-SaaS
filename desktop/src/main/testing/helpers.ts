import { expect, vi } from 'vitest';
import type { GateStatusDTO } from '@csense/shared';
import { jsonReply } from './fakes';
import {
  farFuture,
  grantedStatus,
  installAuthRoutes,
  requiredStatus,
  challengeStatus,
  type World,
} from './world';

export const FAKE_TIMERS = [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'Date',
] as const;

/** Drain pending promise chains without moving fake time. */
export const settle = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await new Promise<void>((r) => setImmediate(r));
};

export const advance = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
};

export function server(w: World, initial: GateStatusDTO = requiredStatus) {
  const state = { status: initial, nextChallenge: challengeStatus(3) };
  installAuthRoutes(w);
  w.fakeApi.on('GET /gate/status', () => jsonReply(200, state.status));
  w.fakeApi.on('POST /gate/challenge', () => {
    if (state.status.state === 'required') state.status = state.nextChallenge;
    return jsonReply(200, state.status);
  });
  return state;
}

export async function loginAs(w: World): Promise<void> {
  const res = await w.session.login({ email: 'user@example.com', password: 'correct-password' });
  expect(res.ok).toBe(true);
  await settle();
}

/** Start the gate, sign in with a valid clearance, press continue: an unlocked workstation. */
export async function toReleased(w: World, clearedUntil = farFuture()) {
  const state = server(w, grantedStatus(clearedUntil));
  await w.gate.start();
  await loginAs(w);
  expect(w.gate.getView().phase).toBe('granted');
  expect(w.gate.continue().ok).toBe(true);
  expect(w.lock.state).toBe('unlocked');
  return state;
}
