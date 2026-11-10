import { expect, test } from '@playwright/test';
import { api, loginHttp } from './support/backend';
import { answerWrongly, signIn } from './support/keys';
import {
  cleanup,
  forceClose,
  launchApp,
  waitForCryptoKeyFlush,
  windowState,
  type Launched,
} from './support/launch';

interface EscalationItem {
  id: string;
  version: number;
  status: string;
}

/**
 * Playbook gate, part 2: retry exhaustion leads to the restricted state, which survives a relaunch
 * and is lifted only by an administrator through the API (plan 12.5).
 */
test.describe.serial('security gate: retry exhaustion -> restricted', () => {
  let s: Launched;
  let userDataDir: string;

  test.afterAll(async () => {
    await forceClose(s.app);
    cleanup(userDataDir);
  });

  test('1. three wrong answers: Access restricted with a GATE- reference; the window stays locked; quit is refused', async () => {
    s = await launchApp();
    userDataDir = s.userDataDir;
    const acct = s.backend.accounts['gate-fail'];
    await signIn(s.page, acct.email, acct.password);
    await expect(s.page.getByRole('heading', { level: 1, name: 'Security check' })).toBeVisible();

    for (let remaining = 3; remaining >= 1; remaining--) {
      await expect(s.page.getByText(new RegExp(`${String(remaining)} of 3`))).toBeVisible();
      await answerWrongly(s.page, s.backend);
      if (remaining > 1) await expect(s.page.getByText('Not quite')).toBeVisible();
    }
    await expect(
      s.page.getByRole('heading', { level: 1, name: 'Access restricted' }),
    ).toBeVisible();
    await expect(s.page.locator('code')).toHaveText(/^GATE-\d{8}-[0-9A-F]{6}$/);
    // No way forward from the UI or the bridge.
    await expect(s.page.getByRole('button', { name: /Continue/ })).toHaveCount(0);
    expect(await s.page.evaluate(() => window.csense?.gate.continue())).toMatchObject({
      ok: false,
      error: { code: 'GATE_LOCKED' },
    });

    expect(await windowState(s.app)).toMatchObject({
      kiosk: true,
      alwaysOnTop: true,
      closable: false,
    });
    // Quit is refused while locked: the process and window are still there afterwards.
    await s.app.evaluate(({ app }) => {
      app.quit();
    });
    await s.page.waitForTimeout(500);
    expect(await windowState(s.app)).toMatchObject({ kiosk: true, visible: true });
  });

  test('2. a relaunch is still restricted, with no new attempts', async () => {
    // The app is locked, so it is killed (quit is refused). Let the session key reach disk first.
    await waitForCryptoKeyFlush(userDataDir);
    await forceClose(s.app);
    s = await launchApp({ userDataDir });
    await expect(s.page.getByRole('heading', { level: 1, name: 'Access restricted' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(s.page.getByRole('heading', { name: 'Security check' })).toHaveCount(0);
    await expect(s.page.getByRole('radio')).toHaveCount(0);
    expect((await windowState(s.app)).kiosk).toBe(true);
  });

  test('3. an administrator acknowledges and restores access over HTTP; the app polls and shows a fresh challenge (3 of 3)', async () => {
    const b = s.backend;
    const adminToken = await loginHttp(b, 'admin');
    const login = await api<{ user: { id: string } }>(b, 'POST', '/auth/login', {
      body: b.accounts['gate-fail'],
    });
    const userId = login.body.user.id;

    // Restoring before anyone has looked at the escalation is refused (D5-7).
    const early = await api<{ error: { code: string } }>(
      b,
      'POST',
      `/admin/users/${userId}/restore-access`,
      {
        token: adminToken,
        body: { note: 'Verified identity by phone.' },
      },
    );
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('ESCALATION_NOT_ACKNOWLEDGED');

    const list = await api<{ items: EscalationItem[] }>(
      b,
      'GET',
      `/admin/escalations?reason=gate_access_restricted&userId=${userId}`,
      { token: adminToken },
    );
    expect(list.status).toBe(200);
    const esc = list.body.items[0];
    expect(esc).toBeDefined();
    if (!esc) return;

    const ack = await api(b, 'PATCH', `/admin/escalations/${esc.id}`, {
      token: adminToken,
      body: { action: 'acknowledge', expectedVersion: esc.version, note: 'Looking into it.' },
    });
    expect(ack.status).toBe(200);

    const restore = await api(b, 'POST', `/admin/users/${userId}/restore-access`, {
      token: adminToken,
      body: { note: 'Verified identity by phone; retrained.' },
    });
    expect(restore.status).toBe(200);

    // The gate polls every 2 s (CSENSE_GATE_POLL_SECONDS) and moves to a fresh run.
    await expect(s.page.getByRole('heading', { level: 1, name: 'Security check' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(s.page.getByText(/3 of 3/)).toBeVisible();
    expect((await windowState(s.app)).kiosk).toBe(true);
  });
});
