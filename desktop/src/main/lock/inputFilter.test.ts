import { describe, expect, it } from 'vitest';
import type { InputEventLike } from '../electron/types';
import { decideInput, type LockProfile } from './inputFilter';

const key = (k: string, mods: Partial<InputEventLike> = {}): InputEventLike => ({
  type: 'keyDown',
  key: k,
  code: '',
  control: false,
  shift: false,
  alt: false,
  meta: false,
  ...mods,
});
const ctrl = (k: string, extra: Partial<InputEventLike> = {}) =>
  key(k, { control: true, ...extra });
const alt = (k: string) => key(k, { alt: true });

/** The canonical table (plan 7.3). `gate` / `lockdown` give the expected decision per profile. */
const table: { name: string; input: InputEventLike; gate: boolean; lockdown: boolean }[] = [
  // Allowed everywhere
  { name: 'Tab', input: key('Tab'), gate: true, lockdown: true },
  { name: 'Shift+Tab', input: key('Tab', { shift: true }), gate: true, lockdown: true },
  { name: 'Enter', input: key('Enter'), gate: true, lockdown: true },
  { name: 'Space', input: key(' '), gate: true, lockdown: true },
  { name: 'ArrowUp', input: key('ArrowUp'), gate: true, lockdown: true },
  { name: 'ArrowDown', input: key('ArrowDown'), gate: true, lockdown: true },
  { name: 'ArrowLeft', input: key('ArrowLeft'), gate: true, lockdown: true },
  { name: 'ArrowRight', input: key('ArrowRight'), gate: true, lockdown: true },
  { name: 'Home', input: key('Home'), gate: true, lockdown: true },
  { name: 'End', input: key('End'), gate: true, lockdown: true },
  { name: 'PageUp', input: key('PageUp'), gate: true, lockdown: true },
  { name: 'PageDown', input: key('PageDown'), gate: true, lockdown: true },
  {
    name: 'Escape (delivered to the renderer only)',
    input: key('Escape'),
    gate: true,
    lockdown: true,
  },
  { name: 'Ctrl+Plus', input: ctrl('+'), gate: true, lockdown: true },
  { name: 'Ctrl+Shift+Plus', input: ctrl('+', { shift: true }), gate: true, lockdown: true },
  { name: 'Ctrl+=', input: ctrl('='), gate: true, lockdown: true },
  { name: 'Ctrl+Minus', input: ctrl('-'), gate: true, lockdown: true },
  { name: 'Ctrl+0', input: ctrl('0'), gate: true, lockdown: true },
  { name: 'Shift key itself', input: key('Shift', { shift: true }), gate: true, lockdown: true },
  {
    name: 'Control key itself',
    input: key('Control', { control: true }),
    gate: true,
    lockdown: true,
  },

  // Gate only: typing and editing in the Login inputs
  { name: 'letter a', input: key('a'), gate: true, lockdown: false },
  { name: 'Shift+A', input: key('A', { shift: true }), gate: true, lockdown: false },
  { name: 'digit 5', input: key('5'), gate: true, lockdown: false },
  { name: '@', input: key('@', { shift: true }), gate: true, lockdown: false },
  {
    name: 'AltGr+@ (Ctrl+Alt)',
    input: key('@', { control: true, alt: true }),
    gate: true,
    lockdown: false,
  },
  { name: 'dead key', input: key('Dead'), gate: true, lockdown: false },
  { name: 'IME Process', input: key('Process'), gate: true, lockdown: false },
  { name: 'Backspace', input: key('Backspace'), gate: true, lockdown: false },
  { name: 'Delete', input: key('Delete'), gate: true, lockdown: false },
  { name: 'Ctrl+A', input: ctrl('a'), gate: true, lockdown: false },
  { name: 'Ctrl+Z', input: ctrl('z'), gate: true, lockdown: false },

  // Clipboard
  { name: 'Ctrl+C', input: ctrl('c'), gate: false, lockdown: false },
  { name: 'Ctrl+V', input: ctrl('v'), gate: false, lockdown: false },
  { name: 'Ctrl+X', input: ctrl('x'), gate: false, lockdown: false },
  { name: 'Cmd+C', input: key('c', { meta: true }), gate: false, lockdown: false },
  { name: 'Cmd+V', input: key('v', { meta: true }), gate: false, lockdown: false },
  { name: 'Ctrl+Insert', input: ctrl('Insert'), gate: false, lockdown: false },
  { name: 'Shift+Insert', input: key('Insert', { shift: true }), gate: false, lockdown: false },
  { name: 'Shift+Delete', input: key('Delete', { shift: true }), gate: false, lockdown: false },
  { name: 'Insert', input: key('Insert'), gate: false, lockdown: false },

  // Reload
  { name: 'Ctrl+R', input: ctrl('r'), gate: false, lockdown: false },
  { name: 'F5', input: key('F5'), gate: false, lockdown: false },
  { name: 'Ctrl+Shift+R', input: ctrl('R', { shift: true }), gate: false, lockdown: false },
  { name: 'Ctrl+F5', input: ctrl('F5'), gate: false, lockdown: false },

  // Devtools
  { name: 'F12', input: key('F12'), gate: false, lockdown: false },
  { name: 'Ctrl+Shift+I', input: ctrl('I', { shift: true }), gate: false, lockdown: false },
  { name: 'Ctrl+Shift+J', input: ctrl('J', { shift: true }), gate: false, lockdown: false },
  { name: 'Ctrl+Shift+C', input: ctrl('C', { shift: true }), gate: false, lockdown: false },

  // Window and document commands
  ...['p', 's', 'o', 'n', 't', 'w', 'f', 'g', 'u'].map((c) => ({
    name: `Ctrl+${c.toUpperCase()}`,
    input: ctrl(c),
    gate: false,
    lockdown: false,
  })),
  { name: 'Ctrl+Shift+N', input: ctrl('N', { shift: true }), gate: false, lockdown: false },
  { name: 'Ctrl+Tab', input: ctrl('Tab'), gate: false, lockdown: false },

  // Alt combinations
  { name: 'Alt+F4', input: alt('F4'), gate: false, lockdown: false },
  { name: 'Alt+Space', input: alt(' '), gate: false, lockdown: false },
  { name: 'Alt+Left', input: alt('ArrowLeft'), gate: false, lockdown: false },
  { name: 'Alt+Right', input: alt('ArrowRight'), gate: false, lockdown: false },
  { name: 'Alt+Home', input: alt('Home'), gate: false, lockdown: false },
  { name: 'Alt+D', input: alt('d'), gate: false, lockdown: false },
  { name: 'Alt key itself', input: key('Alt', { alt: true }), gate: false, lockdown: false },
  { name: 'Meta key itself', input: key('Meta', { meta: true }), gate: false, lockdown: false },

  // Function keys and others
  ...Array.from({ length: 12 }, (_, i) => ({
    name: `F${String(i + 1)}`,
    input: key(`F${String(i + 1)}`),
    gate: false,
    lockdown: false,
  })),
  { name: 'F11 (full screen toggle)', input: key('F11'), gate: false, lockdown: false },
  { name: 'F7 (caret browsing)', input: key('F7'), gate: false, lockdown: false },
  { name: 'Shift+F10', input: key('F10', { shift: true }), gate: false, lockdown: false },
  { name: 'ContextMenu key', input: key('ContextMenu'), gate: false, lockdown: false },
  { name: 'PrintScreen', input: key('PrintScreen'), gate: false, lockdown: false },
  { name: 'Ctrl+Y', input: ctrl('y'), gate: false, lockdown: false },
  { name: 'Ctrl+Shift+A', input: ctrl('A', { shift: true }), gate: false, lockdown: false },
  {
    name: 'Ctrl+Alt+C (not AltGr text in lockdown)',
    input: key('c', { control: true, alt: true }),
    gate: true,
    lockdown: false,
  },
  { name: 'browser back', input: key('BrowserBack'), gate: false, lockdown: false },
];

describe('IF1: input filter decision table', () => {
  for (const profile of ['gate', 'lockdown'] as LockProfile[]) {
    describe(`${profile} profile`, () => {
      for (const row of table) {
        const expected = row[profile];
        it(`${expected ? 'allows' : 'blocks'} ${row.name}`, () => {
          expect(decideInput(profile, row.input).allow).toBe(expected);
        });
      }
    });
  }

  it('blocks every function key F1-F24 in both profiles', () => {
    for (let i = 1; i <= 24; i++) {
      for (const p of ['gate', 'lockdown'] as LockProfile[]) {
        expect(decideInput(p, key(`F${String(i)}`)).allow).toBe(false);
      }
    }
  });

  it('defaults to block for keys it does not know', () => {
    for (const k of ['MediaPlayPause', 'AudioVolumeUp', 'LaunchMail', 'Unidentified', 'NumLock']) {
      expect(decideInput('gate', key(k)).allow, k).toBe(false);
      expect(decideInput('lockdown', key(k)).allow, k).toBe(false);
    }
  });

  it('applies to key-up as well as key-down', () => {
    expect(decideInput('lockdown', { ...ctrl('c'), type: 'keyUp' }).allow).toBe(false);
  });
});
