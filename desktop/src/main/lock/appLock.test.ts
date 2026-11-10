import { describe, expect, it } from 'vitest';
import { CoverManager } from './covers';
import { AppLock, RELEASED_WINDOW_SIZE } from './appLock';
import {
  FakeClipboard,
  FakeDisplays,
  FakeGlobalShortcut,
  FakeWindow,
  recordingLogger,
} from '../testing/fakes';

function make(opts: { tray?: boolean } = {}) {
  const window = new FakeWindow();
  const displays = new FakeDisplays();
  const clipboard = new FakeClipboard();
  const shortcut = new FakeGlobalShortcut();
  const lock = new AppLock({
    window,
    covers: new CoverManager(displays),
    clipboard,
    globalShortcut: shortcut,
    log: recordingLogger(),
    ...(opts.tray ? { canHideToTray: () => true } : {}),
  });
  return { window, displays, clipboard, shortcut, lock };
}

describe('AppLock', () => {
  it('gate profile: kiosk, always on top, not closable/minimisable/movable, devtools closed', () => {
    const { window, lock, clipboard, shortcut } = make();
    clipboard.text = 'keep me: the gate does not clear the clipboard';
    lock.lock('gate');
    expect(window).toMatchObject({
      kiosk: true,
      fullScreen: true,
      alwaysOnTop: true,
      closable: false,
      minimizable: false,
      movable: false,
      skipTaskbar: true,
      visible: true,
      contentProtected: false,
    });
    expect(window.log).toContain('closeDevTools');
    expect(clipboard.text).toBe('keep me: the gate does not clear the clipboard');
    expect(shortcut.registered.size).toBe(0);
    expect(lock.canQuit()).toBe(false);
  });

  it('unlock restores a normal window and is idempotent', () => {
    const { window, lock } = make();
    lock.lock('gate');
    lock.unlock();
    expect(window).toMatchObject({
      kiosk: false,
      fullScreen: false,
      alwaysOnTop: false,
      closable: true,
      minimizable: true,
      movable: true,
      skipTaskbar: false,
      size: RELEASED_WINDOW_SIZE,
    });
    const n = window.log.length;
    lock.unlock();
    expect(window.log.length).toBe(n);
    expect(lock.canQuit()).toBe(true);
  });

  it('covers every other display and follows hot-plugging (R6)', () => {
    const { displays, lock } = make();
    displays.displays = [
      { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } },
    ];
    lock.lock('gate');
    expect(displays.openCovers).toBe(1);
    expect(displays.covers.get(2)?.bounds.x).toBe(1920);

    displays.displays = [
      ...displays.displays,
      { id: 3, bounds: { x: 3840, y: 0, width: 1280, height: 1024 } },
    ];
    displays.change();
    expect(displays.openCovers).toBe(2);

    displays.displays = displays.displays.filter((d) => d.id !== 2);
    displays.change();
    expect(displays.covers.get(2)?.closed).toBe(true);
    expect(displays.openCovers).toBe(1);

    lock.unlock();
    expect(displays.openCovers).toBe(0);
    // Unplugging/plugging after unlock must not resurrect covers.
    displays.change();
    expect(displays.openCovers).toBe(0);
  });

  it('close is prevented while locked; when released it hides to the tray if one exists', () => {
    const noTray = make();
    noTray.lock.lock('gate');
    expect(noTray.window.tryClose()).toBe(true);
    noTray.lock.unlock();
    expect(noTray.window.tryClose()).toBe(false);

    const withTray = make({ tray: true });
    withTray.lock.lock('gate');
    withTray.lock.unlock();
    expect(withTray.window.tryClose()).toBe(true);
    expect(withTray.window.visible).toBe(false);
    // A re-lock brings a hidden window back.
    withTray.lock.lock('gate');
    expect(withTray.window.visible).toBe(true);
  });

  it('OS logoff/shutdown is never blocked, even in lockdown', () => {
    const { window, lock } = make();
    lock.lock('lockdown');
    expect(window.tryClose()).toBe(true);
    window.endSession();
    expect(window.tryClose()).toBe(false);
    expect(lock.canQuit()).toBe(true);
  });

  it('the input filter is inert while unlocked (normal use after release)', () => {
    const { window, lock } = make();
    expect(window.press({ key: 'c', control: true })).toBe(false);
    lock.lock('gate');
    expect(window.press({ key: 'c', control: true })).toBe(true);
    expect(window.press({ key: 'Tab' })).toBe(false);
    lock.unlock();
    expect(window.press({ key: 'c', control: true })).toBe(false);
  });

  it('switching lockdown -> gate undoes the lockdown-only extras', () => {
    const { window, lock, shortcut } = make();
    lock.lock('lockdown');
    expect(window.contentProtected).toBe(true);
    expect(shortcut.registered.has('PrintScreen')).toBe(true);
    lock.lock('gate');
    expect(window.contentProtected).toBe(false);
    expect(shortcut.registered.size).toBe(0);
    expect(window.kiosk).toBe(true);
  });

  it('dispose releases everything', () => {
    const { window, lock, shortcut } = make();
    lock.lock('lockdown');
    lock.dispose();
    expect(window.kiosk).toBe(false);
    expect(shortcut.registered.size).toBe(0);
  });
});

describe('AppLock paste policy', () => {
  function withPaste(provider: () => boolean) {
    const window = new FakeWindow();
    const lock = new AppLock({
      window,
      covers: new CoverManager(new FakeDisplays()),
      clipboard: new FakeClipboard(),
      globalShortcut: new FakeGlobalShortcut(),
      log: recordingLogger(),
      allowPaste: provider,
    });
    return { window, lock };
  }

  it('follows the provider in the gate profile and re-reads it on every key', () => {
    let login = true;
    const { window, lock } = withPaste(() => login);
    lock.lock('gate');
    expect(window.press({ key: 'v', control: true })).toBe(false);
    expect(window.press({ key: 'Insert', shift: true })).toBe(false);
    login = false; // a challenge is now shown
    expect(window.press({ key: 'v', control: true })).toBe(true);
    expect(window.press({ key: 'c', control: true })).toBe(true);
  });

  it('fails closed when the provider throws, and never applies to lockdown', () => {
    const throwing = withPaste(() => {
      throw new Error('state unknown');
    });
    throwing.lock.lock('gate');
    expect(throwing.window.press({ key: 'v', control: true })).toBe(true);

    const quiz = withPaste(() => true);
    quiz.lock.lock('lockdown');
    expect(quiz.window.press({ key: 'v', control: true })).toBe(true);
    expect(quiz.window.press({ key: 'Insert', shift: true })).toBe(true);
  });
});
