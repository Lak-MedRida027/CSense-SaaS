import { describe, expect, it } from 'vitest';
import { jsonReply } from '../testing/fakes';
import { OID, installAuthRoutes, makeWorld, type World } from '../testing/world';
import { OPERATIONS, userResponseSchema } from './operations';

async function signedIn(): Promise<World> {
  const w = makeWorld();
  installAuthRoutes(w);
  expect((await w.session.login({ email: 'u@example.com', password: 'correct-password' })).ok).toBe(
    true,
  );
  return w;
}

const progress = {
  moduleId: OID.module1,
  status: 'in_progress',
  startedAt: '2026-11-10T09:00:00.000Z',
  contentCompletedAt: null,
  exerciseAnswers: [],
};

describe('OPS1: the eight Phase 6 operations', () => {
  it('has the exact set of ids, with PATCH only for onboarding', () => {
    const ids = [
      'modules.detail',
      'modules.start',
      'modules.answerExercise',
      'modules.completeContent',
      'final.overview',
      'me.xp',
      'me.badges',
      'me.onboarding',
    ] as const;
    for (const id of ids) expect(OPERATIONS[id].id).toBe(id);
    const patch = Object.values(OPERATIONS).filter((o) => o.method === 'PATCH');
    expect(patch.map((o) => o.id)).toEqual(['me.onboarding']);
    expect(Object.values(OPERATIONS)).toHaveLength(16 + 8);
  });

  it('OPS2 paths are built from validated, lower-cased ObjectIds and encoded', async () => {
    const w = await signedIn();
    w.fakeApi.on(`POST /modules/${OID.module1}/start`, jsonReply(200, progress));
    const ok = await w.api.call(OPERATIONS['modules.start'], {
      params: { moduleId: OID.module1.toUpperCase() },
    });
    expect(ok.ok).toBe(true);
    const before = w.fakeApi.requests.length;
    for (const bad of ['../x', 'abc', `${OID.module1}/exercises`, '%2e%2e']) {
      const res = await w.api.call(OPERATIONS['modules.start'], { params: { moduleId: bad } });
      expect(res).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    }
    expect(w.fakeApi.requests).toHaveLength(before);
  });

  it('OPS3 PATCH sends a JSON body, validated; bad bodies send nothing', async () => {
    const w = await signedIn();
    w.fakeApi.on('PATCH /me/onboarding', jsonReply(200, { outcome: 'skipped', at: 'x' }));
    const res = await w.api.call(OPERATIONS['me.onboarding'], { body: { outcome: 'skipped' } });
    expect(res).toMatchObject({ ok: true, data: { outcome: 'skipped' } });
    const sent = w.fakeApi.requests.at(-1);
    expect(sent?.method).toBe('PATCH');
    expect(sent?.body).toEqual({ outcome: 'skipped' });
    expect(sent?.headers['content-type']).toBe('application/json');
    const before = w.fakeApi.requests.length;
    for (const body of [{ outcome: 'done' }, { outcome: 'completed', extra: 1 }, {}]) {
      const bad = await w.api.call(OPERATIONS['me.onboarding'], {
        body: body as { outcome: 'completed' },
      });
      expect(bad).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    }
    expect(w.fakeApi.requests).toHaveLength(before);
  });

  it('OPS4 strict responses: an extra correctAnswer/explanation field is BAD_RESPONSE', async () => {
    const w = await signedIn();
    w.fakeApi.on(
      `POST /modules/${OID.module1}/exercises/${OID.q1}/answers`,
      jsonReply(200, {
        exerciseId: OID.q1,
        selectedIndex: 0,
        correct: true,
        correctIndex: 0,
        explanation: 'e',
        recorded: true,
        correctAnswer: 'leak',
      }),
    );
    expect(
      await w.api.call(OPERATIONS['modules.answerExercise'], {
        params: { moduleId: OID.module1, exerciseId: OID.q1 },
        body: { selectedIndex: 0 },
      }),
    ).toMatchObject({ ok: false, error: { code: 'BAD_RESPONSE' } });
    w.fakeApi.on(
      'GET /me/badges',
      jsonReply(200, { items: [], earnedCount: 0, totalCount: 0, x: 1 }),
    );
    expect(await w.api.call(OPERATIONS['me.badges'])).toMatchObject({
      ok: false,
      error: { code: 'BAD_RESPONSE' },
    });
  });

  it('userResponseSchema carries onboarding (null, a state, or absent) and is bounded', () => {
    const base = { id: 'a', name: 'n', role: 'employee' as const };
    expect(userResponseSchema.parse({ ...base, onboarding: null }).onboarding).toBeNull();
    expect(
      userResponseSchema.parse({ ...base, onboarding: { outcome: 'skipped', at: 't' } }).onboarding,
    ).toEqual({ outcome: 'skipped', at: 't' });
    expect(userResponseSchema.parse(base).onboarding).toBeUndefined();
    expect(() =>
      userResponseSchema.parse({ ...base, onboarding: { outcome: 'x', at: 't' } }),
    ).toThrow();
  });
});
