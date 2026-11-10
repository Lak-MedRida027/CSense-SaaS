/**
 * Keyboard allowlist for the locked profiles (plan 7.3, ADR 0016 item 5). Default is BLOCK.
 *
 * Pure decision function, table-tested per profile. It is what `before-input-event` consults.
 * What this cannot do: Ctrl+Alt+Del, Win-key combinations and Alt+Tab never reach the app (plan 7.6).
 */
import type { InputEventLike } from '../electron/types';

export type LockProfile = 'gate' | 'lockdown';

const NAVIGATION_KEYS: ReadonlySet<string> = new Set([
  'Tab',
  'Enter',
  ' ',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  // Escape reaches the renderer only to close the "Leave the quiz?" dialog; it never exits lockdown.
  'Escape',
]);

/** Held-down modifier keys themselves: harmless, and needed to form Shift+Tab or Ctrl+Plus. */
const BENIGN_MODIFIER_KEYS: ReadonlySet<string> = new Set([
  'Control',
  'Shift',
  'CapsLock',
  'AltGraph',
]);

/** Composition keys for typing accented characters in the Login fields. */
const COMPOSITION_KEYS: ReadonlySet<string> = new Set(['Dead', 'Process']);

const ZOOM_KEYS: ReadonlySet<string> = new Set(['+', '=', '-', '_']);

function isPrintable(key: string): boolean {
  return Array.from(key).length === 1 && key !== ' ';
}

export interface InputDecision {
  allow: boolean;
}

export interface InputContext {
  /**
   * Gate profile only, and only while the Login step is shown: allow paste (Ctrl+V, Shift+Insert)
   * so password managers work (NIST SP 800-63B). Absent or false means blocked (fail closed). Login
   * is the only editable page in that state, so the paste can only land in its two inputs.
   */
  allowPaste?: boolean;
}

export function decideInput(
  profile: LockProfile,
  input: InputEventLike,
  ctx: InputContext = {},
): InputDecision {
  const { key, control, alt, shift, meta } = input;
  const block: InputDecision = { allow: false };
  const allow: InputDecision = { allow: true };

  // Win/Cmd: never delivered on Windows, but block defensively (Cmd on macOS).
  if (meta || key === 'Meta') return block;

  if (alt) {
    // Ctrl+Alt is AltGr on many keyboards: allow printable characters in the gate (the "@" in an email).
    if (control && profile === 'gate' && isPrintable(key)) return allow;
    return block;
  }
  if (key === 'Alt') return block;

  if (BENIGN_MODIFIER_KEYS.has(key)) return allow;

  const pasteOk = profile === 'gate' && ctx.allowPaste === true;

  if (control) {
    // Zoom (WCAG 1.4.4): Ctrl+Plus, Ctrl+Minus, Ctrl+0.
    if (ZOOM_KEYS.has(key)) return allow;
    if (key === '0' && !shift) return allow;
    if (pasteOk && !shift && key.toLowerCase() === 'v') return allow;
    // Editing in the Login inputs only.
    if (profile === 'gate' && !shift && (key.toLowerCase() === 'a' || key.toLowerCase() === 'z')) {
      return allow;
    }
    return block;
  }

  if (pasteOk && shift && key === 'Insert') return allow;
  if (key === 'Insert' || key === 'ContextMenu') return block;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return block;

  if (NAVIGATION_KEYS.has(key)) return allow;
  if (shift && (key === 'Delete' || key === 'Backspace')) return block;

  if (profile === 'gate') {
    if (key === 'Backspace' || key === 'Delete') return allow;
    if (COMPOSITION_KEYS.has(key) || isPrintable(key)) return allow;
  }
  return block;
}
