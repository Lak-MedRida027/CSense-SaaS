import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { requestCount } from './support/backend';
import {
  DASHBOARD_HEADING,
  backToDashboard,
  openModuleQuiz,
  passGate,
  startSecureQuiz,
} from './support/journey';
import { signIn } from './support/keys';
import {
  cleanup,
  forceClose,
  killWorktreeElectron,
  launchApp,
  windowState,
} from './support/launch';

const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/;
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{40,}$/;

test('no token reaches the renderer: not in web storage, cookies, IndexedDB or any bridge result (S8)', async () => {
  const s = await launchApp();
  try {
    const acct = s.backend.accounts['gate-pass'];
    await signIn(s.page, acct.email, acct.password);
    // A clearance from an earlier spec may apply, in which case the gate shows "Access granted".
    await expect(
      s.page.getByRole('heading', { level: 1, name: /Security check|Access granted/ }),
    ).toBeVisible();

    const dump = await s.page.evaluate(async () => {
      const storage = (st: Storage): string[] =>
        Array.from({ length: st.length }, (_, i) => {
          const k = st.key(i) ?? '';
          return `${k}=${st.getItem(k) ?? ''}`;
        });
      const dbs = await indexedDB.databases();
      const bridge = window.csense;
      const reads = bridge
        ? await Promise.all([
            bridge.session.getState(),
            bridge.gate.getView(),
            bridge.assessment.resume(),
            bridge.learning.getOverview(),
          ])
        : [];
      return {
        local: storage(localStorage),
        session: storage(sessionStorage),
        cookie: document.cookie,
        indexedDb: dbs.map((d) => d.name ?? ''),
        reads: JSON.stringify(reads),
      };
    });

    expect(dump.local.length + dump.session.length).toBeLessThan(5);
    for (const entry of [...dump.local, ...dump.session, dump.cookie, ...dump.indexedDb]) {
      expect(entry).not.toMatch(JWT);
      const value = entry.includes('=') ? entry.slice(entry.indexOf('=') + 1) : entry;
      expect(value).not.toMatch(OPAQUE_TOKEN);
    }
    expect(dump.cookie).toBe('');
    expect(dump.reads).not.toMatch(/accessToken|refreshToken|"token"/i);
    expect(dump.reads).not.toMatch(JWT);
    expect(dump.reads).not.toMatch(/correctAnswer|correctIndex/);

    // Nor does the DOM.
    const html = await s.page.content();
    expect(html).not.toMatch(JWT);
  } finally {
    await forceClose(s.app);
    cleanup(s.userDataDir);
  }
});

test('the renderer cannot open a network connection: fetch, XHR, WebSocket and images are blocked (S4)', async () => {
  const s = await launchApp();
  try {
    const before = await requestCount(s.backend);
    const outcome = await s.page.evaluate(async (base) => {
      const settle = async (p: Promise<unknown>): Promise<string> =>
        p.then(
          () => 'allowed',
          () => 'blocked',
        );
      const xhr = new Promise<void>((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open('GET', `${base}/modules`);
        x.onload = () => {
          resolve();
        };
        x.onerror = () => {
          reject(new Error('blocked'));
        };
        x.send();
      });
      const ws = new Promise<void>((resolve, reject) => {
        try {
          const sock = new WebSocket(base.replace('http', 'ws'));
          sock.onopen = () => {
            resolve();
          };
          sock.onerror = () => {
            reject(new Error('blocked'));
          };
        } catch (e) {
          reject(e instanceof Error ? e : new Error('blocked'));
        }
      });
      const img = new Promise<void>((resolve, reject) => {
        const i = new Image();
        i.onload = () => {
          resolve();
        };
        i.onerror = () => {
          reject(new Error('blocked'));
        };
        i.src = `${base}/health`;
      });
      return {
        fetchApi: await settle(fetch(`${base}/health`)),
        fetchOther: await settle(fetch('https://example.com/')),
        xhr: await settle(xhr),
        ws: await settle(ws),
        img: await settle(img),
      };
    }, s.backend.baseUrl);
    expect(outcome).toEqual({
      fetchApi: 'blocked',
      fetchOther: 'blocked',
      xhr: 'blocked',
      ws: 'blocked',
      img: 'blocked',
    });
    expect(await requestCount(s.backend)).toBe(before);
  } finally {
    await forceClose(s.app);
    cleanup(s.userDataDir);
  }
});

test('a non-https, non-loopback API URL is refused: misconfigured screen, nothing sent anywhere (S23)', async () => {
  const s = await launchApp({ env: { CSENSE_API_BASE_URL: 'http://example.com/api/v1' } });
  try {
    const before = await requestCount(s.backend);
    await expect(
      s.page.getByRole('heading', { level: 1, name: 'CSense is misconfigured' }),
    ).toBeVisible();
    expect(await windowState(s.app)).toMatchObject({
      kiosk: true,
      alwaysOnTop: true,
      closable: false,
    });
    // The bridge refuses to sign in and the gate cannot be released.
    const login = await s.page.evaluate(() =>
      window.csense?.session.login({ email: 'a@b.co', password: 'whatever-pw-123' }),
    );
    expect(login).toMatchObject({ ok: false, error: { code: 'MISCONFIGURED' } });
    expect(await s.page.evaluate(() => window.csense?.gate.continue())).toMatchObject({
      ok: false,
      error: { code: 'GATE_LOCKED' },
    });
    await s.page.waitForTimeout(1000);
    expect(await requestCount(s.backend)).toBe(before);
  } finally {
    await forceClose(s.app);
    cleanup(s.userDataDir);
  }
});

test('credentials in the API URL are refused as well (I6)', async () => {
  const s = await launchApp({
    env: { CSENSE_API_BASE_URL: 'http://user:pw@127.0.0.1:1/api/v1' },
  });
  try {
    await expect(
      s.page.getByRole('heading', { level: 1, name: 'CSense is misconfigured' }),
    ).toBeVisible();
  } finally {
    await forceClose(s.app);
    cleanup(s.userDataDir);
  }
});

/**
 * P5-L7. Page script `window.close()` destroys an Electron window with no cancellable event. The
 * main world's `close` is redefined (a no-op for ordinary script), but a compromised page can call
 * the NATIVE function of another realm (`iframe.contentWindow.close.call(window)`), which really
 * closes the window (measured on Electron 45). The control is therefore the `closed` -> relaunch
 * fallback: the gate must come back. The relaunched instance is not tracked by Playwright, so it is
 * observed through the app's own log and then killed by executable path.
 */
async function expectRelaunchIntoLockedGate(userDataDir: string): Promise<void> {
  const logFile = join(userDataDir, 'logs', 'main.log');
  await expect
    .poll(
      () => {
        const text = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
        const lost = text.indexOf('window.destroyed_unexpectedly');
        return lost >= 0 && text.indexOf('"event":"lock.locked"', lost) > lost;
      },
      { timeout: 40_000 },
    )
    .toBe(true);
}

test('P5-L7: closing the window through an iframe realm relaunches the app into a locked gate', async () => {
  test.skip(process.platform !== 'win32', 'process cleanup by executable path is Windows-only');
  const s = await launchApp();
  try {
    await s.page
      .evaluate(() => {
        const frame = document.createElement('iframe');
        document.body.appendChild(frame);
        (frame.contentWindow as unknown as { close: () => void }).close.call(window);
      })
      .catch(() => undefined);
    await expectRelaunchIntoLockedGate(s.userDataDir);
  } finally {
    killWorktreeElectron();
    await new Promise((r) => setTimeout(r, 1500));
    cleanup(s.userDataDir);
  }
});

test('P5-L7: any other unexpected destruction of the window relaunches the same way', async () => {
  test.skip(process.platform !== 'win32', 'process cleanup by executable path is Windows-only');
  const s = await launchApp();
  try {
    await s.app
      .evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith('/index.html'))
          ?.destroy();
      })
      .catch(() => undefined);
    await expectRelaunchIntoLockedGate(s.userDataDir);
  } finally {
    killWorktreeElectron();
    await new Promise((r) => setTimeout(r, 1500));
    cleanup(s.userDataDir);
  }
});

/**
 * Phase 6 properties (plan 9.5, 10): the closed-book rule, renderer storage and the leak scan. One
 * app, one short module plus quiz pass with the `quiz` account (Module 1's content is pre-completed).
 */
test('Phase 6: closed book, storage holds only display preferences, no key or remote URL reaches the renderer', async () => {
  const s = await launchApp();
  try {
    await passGate(s.page, s.backend, 'quiz');
    await expect(s.page.getByRole('heading', { level: 1, name: DASHBOARD_HEADING })).toBeVisible();

    // Collect every bridge result seen along the way.
    const collected: string[] = [];
    const read = async (): Promise<void> => {
      collected.push(
        await s.page.evaluate(async () => {
          const b = window.csense;
          if (!b) return '';
          const overview = await b.learning.getOverview();
          const first = overview.ok ? overview.data.modules[0] : undefined;
          return JSON.stringify([
            overview,
            await b.me.getXp(),
            await b.me.getBadges(),
            first ? await b.learning.getModule({ moduleId: first.id }) : null,
            first ? await b.learning.getQuizOverview({ moduleId: first.id }) : null,
            await b.learning.getFinalTestOverview(),
          ]);
        }),
      );
    };
    await read();

    // A display preference is the only thing that may be stored (E9).
    await s.page.getByRole('button', { name: 'Settings' }).click();
    await s.page.getByRole('radio', { name: 'Light' }).check({ force: true });
    await s.page.getByRole('button', { name: 'Done' }).click();
    const storage = await s.page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
      pref: JSON.parse(localStorage.getItem('csense.ui.v1') ?? 'null') as unknown,
    }));
    expect(storage.local).toEqual(['csense.ui.v1']);
    expect(storage.session).toEqual([]);
    expect(Object.keys((storage.pref as { prefs: object }).prefs).sort()).toEqual([
      'motion',
      'textSize',
      'theme',
    ]);

    // Closed book: while the quiz is locked down every learning.* and me.* channel is refused (E6).
    await openModuleQuiz(s.page);
    await startSecureQuiz(s.page);
    const refused = await s.page.evaluate(async () => {
      const b = window.csense;
      if (!b) return [];
      const id = 'a'.repeat(24);
      const calls: Promise<unknown>[] = [
        b.learning.getOverview(),
        b.learning.getQuizOverview({ moduleId: id }),
        b.learning.getModule({ moduleId: id }),
        b.learning.startModule({ moduleId: id }),
        b.learning.answerExercise({ moduleId: id, exerciseId: id, selectedIndex: 0 }),
        b.learning.completeContent({ moduleId: id }),
        b.learning.getFinalTestOverview(),
        b.me.getXp(),
        b.me.getBadges(),
        b.me.completeOnboarding({ outcome: 'completed' }),
      ];
      const results = (await Promise.all(calls)) as { ok: boolean; error?: { code: string } }[];
      return results.map((r) => (r.ok ? 'ok' : (r.error?.code ?? '?')));
    });
    expect(refused).toHaveLength(10);
    expect(refused.every((c) => c === 'LOCKDOWN_ACTIVE')).toBe(true);

    // Leave the quiz and look again: reads work, and nothing sensitive was ever delivered.
    await s.page.getByRole('button', { name: 'Exit quiz' }).click();
    await s.page.getByRole('button', { name: 'Leave quiz' }).click();
    await expect(s.page.getByText(/You left the quiz/)).toBeVisible({ timeout: 15_000 });
    await backToDashboard(s.page);
    await read();
    const all = collected.join('\n');
    expect(all).not.toMatch(/correctAnswer/);
    expect(all).not.toMatch(/https?:\/\//);
    expect(all).not.toMatch(/"explanation"/);
    expect(all).toContain('app://csense/media/');
  } finally {
    await forceClose(s.app);
    cleanup(s.userDataDir);
  }
});
