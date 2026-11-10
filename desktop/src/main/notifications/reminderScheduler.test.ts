import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MainEvent } from '../../shared/ipcChannels';
import { FakeFs, FakeNotification, jsonReply } from '../testing/fakes';
import { FAKE_TIMERS, advance, settle, toReleased } from '../testing/helpers';
import { OID, makeWorld, testConfig, type World } from '../testing/world';
import { ReminderScheduler } from './reminderScheduler';

const STATE = '/data/reminders.json';

beforeEach(() => {
  vi.useFakeTimers({ toFake: [...FAKE_TIMERS] });
  vi.setSystemTime(new Date('2026-11-10T08:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

const moduleSummary = (position: number, status: string) => ({
  id: OID.module1,
  position,
  title: 'Phishing basics: SECRET TITLE',
  description: 'd',
  format: 'video',
  durationMinutes: 5,
  status,
  lockedBy: null,
  attempts: 0,
  bestScore: null,
  passed: false,
  completedAt: null,
});

function overview(opts: { moduleStatus?: string; finalStatus?: string } = {}) {
  return {
    modules: [moduleSummary(3, opts.moduleStatus ?? 'in_progress')],
    totalModules: 7,
    completedCount: 2,
    nextModuleId: OID.module1,
    finalTest: opts.finalStatus
      ? {
          status: opts.finalStatus,
          title: 'Final',
          questionCount: 15,
          passingScore: 70,
          remainingModules: 0,
          attempts: 0,
          bestScore: null,
          passed: false,
          completedAt: null,
        }
      : null,
  };
}

async function make(over: { suppressed?: boolean; focused?: boolean; maxPerDay?: number } = {}) {
  const w: World = makeWorld();
  await toReleased(w);
  const notification = new FakeNotification();
  const fs = new FakeFs();
  const events: MainEvent[] = [];
  const shown: string[] = [];
  const flags = { suppressed: over.suppressed ?? false, focused: over.focused ?? false };
  const modules = { body: overview() };
  w.fakeApi.on('GET /modules', () => jsonReply(200, modules.body));
  const scheduler = new ReminderScheduler({
    config: {
      reminders: { ...testConfig.reminders, maxPerDay: over.maxPerDay ?? 2 },
    },
    api: w.api,
    notification,
    fs,
    statePath: STATE,
    isSuppressed: () => flags.suppressed,
    isSignedIn: () => true,
    isWindowFocused: () => flags.focused,
    showWindow: () => {
      shown.push('show');
    },
    emit: (e) => {
      events.push(e);
    },
    log: w.log,
  });
  return { w, scheduler, notification, fs, events, shown, flags, modules };
}

describe('ReminderScheduler (D5-21)', () => {
  it('NT1a: continue-training fires after the first delay when learning has been idle', async () => {
    const { scheduler, notification } = await make();
    scheduler.start();
    await advance(119 * 60_000);
    expect(notification.shown).toHaveLength(0);
    await advance(2 * 60_000);
    expect(notification.shown).toHaveLength(1);
    expect(notification.shown[0]).toMatchObject({
      title: 'CSense',
      body: 'Training reminder: continue Module 3.',
    });
  });

  it('NT1b: recent learning activity suppresses the continue reminder', async () => {
    const { scheduler, notification } = await make();
    scheduler.start();
    await advance(100 * 60_000);
    scheduler.noteLearningActivity();
    await advance(30 * 60_000); // tick at 120 min: only 30 minutes since activity
    expect(notification.shown).toHaveLength(0);
  });

  it('NT1c: a one-shot "quiz available again" fires when the cooldown ends', async () => {
    const { scheduler, notification } = await make();
    scheduler.start();
    scheduler.noteCooldown(new Date(Date.now() + 10 * 60_000).toISOString());
    await advance(9 * 60_000);
    expect(notification.shown).toHaveLength(0);
    await advance(2 * 60_000);
    expect(notification.shown.map((n) => n.body)).toEqual(['You can retry the quiz now.']);
  });

  it('NT1d: the final assessment unlocking is announced once', async () => {
    const { scheduler, notification, modules } = await make();
    modules.body = overview({ moduleStatus: 'completed', finalStatus: 'locked' });
    await scheduler.tick();
    expect(notification.shown).toHaveLength(0); // locked: remembered, nothing shown
    modules.body = overview({ moduleStatus: 'completed', finalStatus: 'unlocked' });
    await scheduler.tick();
    expect(notification.shown.map((n) => n.body)).toEqual([
      'The final assessment is now available.',
    ]);
    await scheduler.tick();
    expect(notification.shown).toHaveLength(1);
  });

  it('NT2: at most maxPerDay per day, and the counter resets the next day', async () => {
    const { scheduler, notification } = await make({ maxPerDay: 2 });
    scheduler.start();
    for (const minutes of [121, 241, 241, 241]) await advance(minutes * 60_000);
    // Several intervals passed on the same day, still only two were shown.
    const today = notification.shown.length;
    expect(today).toBeLessThanOrEqual(2);
    expect(today).toBe(2);
    vi.setSystemTime(new Date('2026-11-11T09:00:00Z'));
    await scheduler.tick();
    expect(notification.shown).toHaveLength(3);
  });

  it('NT3: nothing is shown during the gate or lockdown, nor while the window is focused', async () => {
    const m = await make();
    m.scheduler.start();
    m.flags.suppressed = true;
    await advance(130 * 60_000);
    expect(m.notification.shown).toHaveLength(0);
    m.flags.suppressed = false;
    m.flags.focused = true;
    await advance(250 * 60_000);
    expect(m.notification.shown).toHaveLength(0);
    m.flags.focused = false;
    await advance(250 * 60_000);
    expect(m.notification.shown).toHaveLength(1);
  });

  it('NT3b: a cooldown reminder that fires while locked is dropped, not queued', async () => {
    const m = await make();
    m.flags.suppressed = true;
    m.scheduler.noteCooldown(new Date(Date.now() + 60_000).toISOString());
    await advance(120_000);
    expect(m.notification.shown).toHaveLength(0);
  });

  it('NT4 (S24): clicking focuses the window and navigates home only; ignored while locked', async () => {
    const m = await make();
    m.scheduler.start();
    await advance(121 * 60_000);
    const n = m.notification.shown[0];
    n?.click();
    expect(m.shown).toEqual(['show']);
    expect(m.events).toEqual([{ type: 'navigate', to: 'home' }]);

    m.flags.suppressed = true;
    n?.click();
    expect(m.shown).toHaveLength(1);
    expect(m.events).toHaveLength(1);
  });

  it('NT5: an unsupported platform is a no-op (no request, no throw)', async () => {
    const m = await make();
    m.notification.supported = false;
    const before = m.w.fakeApi.count('GET /modules');
    await m.scheduler.tick();
    expect(m.w.fakeApi.count('GET /modules')).toBe(before);
    expect(m.notification.shown).toHaveLength(0);
  });

  it('NT6: persisted state carries counts and timestamps only, never titles or ids', async () => {
    const m = await make();
    m.scheduler.start();
    await advance(121 * 60_000);
    const raw = m.fs.text(STATE) ?? '';
    expect(raw).not.toMatch(/SECRET TITLE|Phishing|Module|aaaaaaaa|bbbbbbbb/);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      'countToday',
      'day',
      'finalWasLocked',
      'lastShownAt',
    ]);
    expect(Object.keys(parsed.lastShownAt as object)).toEqual(['continue']);
  });

  it('NT6b: the notification text is generic: no scores, risk, titles or question text', async () => {
    const m = await make();
    m.modules.body = overview({ moduleStatus: 'completed', finalStatus: 'unlocked' });
    m.scheduler.noteCooldown(new Date(Date.now() + 1000).toISOString());
    await advance(2000);
    await m.scheduler.tick();
    m.scheduler.start();
    await advance(130 * 60_000);
    for (const n of m.notification.shown) {
      expect(n.title + n.body).not.toMatch(/\d{2,3}%|risk|score|SECRET|Phishing/i);
    }
  });

  it('stop() cancels pending checks', async () => {
    const m = await make();
    m.scheduler.start();
    m.scheduler.stop();
    await advance(600 * 60_000);
    expect(m.notification.shown).toHaveLength(0);
    await settle();
  });
});
