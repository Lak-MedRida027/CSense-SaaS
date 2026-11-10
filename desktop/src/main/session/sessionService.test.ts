import { describe, expect, it } from 'vitest';
import { apiError, jsonReply } from '../testing/fakes';
import { OID, installAuthRoutes, loginBody, makeWorld } from '../testing/world';

const CREDS = { email: 'user@example.com', password: 'correct-password' };

describe('SessionService', () => {
  it('login stores the session; the view carries the user and persistence mode, never tokens', async () => {
    const w = makeWorld();
    installAuthRoutes(w);
    const res = await w.session.login(CREDS);
    expect(res).toMatchObject({
      ok: true,
      data: {
        status: 'signed_in',
        persistence: 'encrypted',
        user: { role: 'employee', level: 'Apprentice' },
      },
    });
    expect(JSON.stringify(res)).not.toMatch(/token/i);
    expect(w.tokens.getAccess()?.token).toBe('access-token-1');
  });

  it('a wrong password is the server error, nothing is stored, and the password is not logged', async () => {
    const w = makeWorld();
    installAuthRoutes(w);
    const res = await w.session.login({ ...CREDS, password: 'nope-nope-nope' });
    expect(res).toMatchObject({ ok: false, error: { code: 'INVALID_CREDENTIALS' } });
    expect(w.tokens.getRefresh()).toBeNull();
    expect(w.fs.files.size).toBe(0);
    expect(JSON.stringify(w.log.events)).not.toContain('nope-nope-nope');
  });

  it('memory-only persistence is reported when OS encryption is unavailable (S7)', async () => {
    const w = makeWorld();
    w.safeStorage.available = false;
    installAuthRoutes(w);
    const res = await w.session.login(CREDS);
    expect(res).toMatchObject({ ok: true, data: { persistence: 'memory_only' } });
    expect(w.fs.ops).toEqual([]);
  });

  it('restore: a persisted session resumes silently (refresh, then /auth/me)', async () => {
    const first = makeWorld();
    installAuthRoutes(first);
    await first.session.login(CREDS);
    const second = makeWorld();
    second.fs.files = new Map(first.fs.files);
    installAuthRoutes(second);
    expect(await second.session.restore()).toBe('signed_in');
    expect(second.session.getView()).toMatchObject({ status: 'signed_in', user: { id: OID.user } });
    expect(second.fakeApi.count('POST /auth/login')).toBe(0);
    expect(second.fakeApi.count('POST /auth/refresh')).toBe(1);
  });

  it('restore with nothing stored is signed out and makes no request', async () => {
    const w = makeWorld();
    expect(await w.session.restore()).toBe('signed_out');
    expect(w.fakeApi.requests).toHaveLength(0);
  });

  it('restore with a revoked refresh token wipes the file and reports the session ended', async () => {
    const first = makeWorld();
    installAuthRoutes(first);
    await first.session.login(CREDS);
    const second = makeWorld();
    second.fs.files = new Map(first.fs.files);
    second.fakeApi.on('POST /auth/refresh', apiError(401, 'INVALID_REFRESH_TOKEN'));
    expect(await second.session.restore()).toBe('signed_out');
    expect(second.fs.files.size).toBe(0);
    expect(second.session.getView().endedNotice).toBe('session_ended');
  });

  it('restore while offline leaves the status unknown and keeps the file', async () => {
    const first = makeWorld();
    installAuthRoutes(first);
    await first.session.login(CREDS);
    const second = makeWorld();
    second.fs.files = new Map(first.fs.files);
    second.fakeApi.on('POST /auth/refresh', { status: 0, throws: true });
    expect(await second.session.restore()).toBe('network_error');
    expect(second.session.getView().status).toBe('unknown');
    expect(second.fs.files.size).toBe(1);
  });

  it('TS-logout: wipes memory and file even when the network fails', async () => {
    const w = makeWorld();
    installAuthRoutes(w);
    await w.session.login(CREDS);
    w.fakeApi.on('POST /auth/logout', { status: 0, throws: true });
    const res = await w.session.logout();
    expect(res.ok).toBe(true);
    expect(w.tokens.getAccess()).toBeNull();
    expect(w.tokens.getRefresh()).toBeNull();
    expect(w.fs.files.size).toBe(0);
    expect(w.session.getView().status).toBe('signed_out');
    expect(w.fakeApi.count('POST /auth/logout')).toBe(1);
    // A voluntary logout is not "the session ended".
    expect(w.sessionEnded).toEqual([]);
    expect(w.session.getView().endedNotice).toBeUndefined();
  });

  it('logout sends the refresh token only in the body of POST /auth/logout', async () => {
    const w = makeWorld();
    installAuthRoutes(w);
    await w.session.login(CREDS);
    await w.session.logout();
    const req = w.fakeApi.requests.find((r) => r.path === '/auth/logout');
    expect(req?.body).toEqual({ refreshToken: 'refresh-token-1' });
  });

  it('logout when already signed out sends nothing', async () => {
    const w = makeWorld();
    await w.session.logout();
    expect(w.fakeApi.requests).toHaveLength(0);
  });

  it('a malformed login response is BAD_RESPONSE and stores nothing', async () => {
    const w = makeWorld();
    w.fakeApi.on('POST /auth/login', jsonReply(200, { ...loginBody(), refreshToken: undefined }));
    expect(await w.session.login(CREDS)).toMatchObject({
      ok: false,
      error: { code: 'BAD_RESPONSE' },
    });
    expect(w.tokens.getRefresh()).toBeNull();
  });

  it('rate-limited login surfaces retryAfterSeconds', async () => {
    const w = makeWorld();
    w.fakeApi.on(
      'POST /auth/login',
      apiError(429, 'RATE_LIMITED', { headers: { 'retry-after': '300' } }),
    );
    expect(await w.session.login(CREDS)).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED', retryAfterSeconds: 300 },
    });
  });
});
