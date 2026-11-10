# ADR 0016: Quiz kiosk lockdown, enforced in the main process

- Status: Accepted 2026-11-10 (Phase 5 plan section 7, decisions D5-15 to D5-19)
- Date: 2026-11-10
- Deciders: Technical architect, product owner (approval), security-tester (review)
- Builds on: ADR 0001 (lockdown enforced in main), ADR 0007 (assessment sessions; leaving counts as an attempt)

## Context
CLAUDE.md requires a kiosk/lockdown mode that restricts shortcuts, the clipboard and devtools while a quiz is active. Phase 1 designed `LockdownShell`: questions render only when lockdown is `active`, and "Exit quiz" is always visible (WCAG 2.1.2). ADR 0007 counts leaving a quiz as an attempt. Electron runs in user space, and Windows reserves several key combinations.

## Decision
1. **Coupled to the server session.**
   - Lockdown is entered only by `assessment.startSecure`: main locks the window, starts the server session itself, and only then returns the questions.
   - Submit, exit and resume must name that session.
   - There is no free-standing "enter lockdown" call. Main never trusts a renderer-supplied session id.
2. **Window state:** kiosk, full screen, always on top (`screen-saver` level), not closable, minimisable or movable, skip taskbar, plus cover windows on other displays.
3. **`setContentProtection(true)`** blacks out screenshots and screen recording of the window (`WDA_EXCLUDEFROMCAPTURE`). A best-effort `PrintScreen` global shortcut is registered.
4. **Clipboard:** cleared on entry and on exit; copy, cut and paste blocked in the input filter and in the renderer. No periodic clearing.
5. **Input filter** (`before-input-event`, default block).
   - Allowed: Tab, Shift+Tab, Enter, Space, arrows, Home, End, Page keys, zoom (Ctrl+Plus, Ctrl+Minus, Ctrl+0), and Escape for the exit dialog only.
   - Everything else is blocked, including Ctrl+C/V/X, Insert combinations, reload, devtools keys, print, save, find, new or close window, F1 to F12 and Alt combinations.
   - Context menus are not built, and drag-and-drop navigation is off.
6. **Devtools:** disabled in packaged builds; closed on entry in every build; a `devtools-opened` event triggers a close and is counted as a violation.
7. **Focus loss:**
   - Refocus and warn on each blur longer than 500 ms.
   - Auto-abandon (counted server-side as `abandoned`) at the 3rd loss, or after 15 s away.
8. **Always exitable:**
   - "Exit quiz" unlocks locally first, then abandons in the background with retries and a persisted pending-abandon record.
   - A first renderer crash reloads and resumes from main's cached session (questions, no keys).
   - A second crash, or a hang over 10 s (followed by a forced crash), exits.
   - A hard cap applies at `expiresAt + 60 s`.
   - A main-process crash removes every restriction, because they are window and process properties.
   - OS logoff and shutdown are never blocked.
9. **Honest limits** (documented, manual Phase 9 checklist):
   - Ctrl+Alt+Del and Ctrl+Shift+Esc, Task Manager and process kill
   - Win-key combinations, Alt+Tab (reserved by Windows; the window stays on top and the blur policy applies)
   - clipboard history and sync
   - capture at hypervisor or remote-desktop level
   - second devices and cameras

   Assistive technologies are intentionally not blocked. Phase 10 fleet policy (Assigned Access, `NoWinKeys`, `DisableTaskMgr`, `AllowClipboardHistory=0`) narrows the list.

## Consequences
- Positive:
  - The anti-cheating controls live where the renderer cannot undo them.
  - Questions never exist in the renderer outside lockdown.
  - Every exit path is tested.
  - Violations feed the existing Behavioural conduct signal through abandoned attempts, with no new route.
- Negative:
  - Focus-stealing system dialogs can cost an attempt.
  - Clearing the clipboard discards the user's unrelated clipboard content (they are told on the quiz intro).
  - Synthetic e2e input may not exercise the exact real-keyboard path, so the filter's decision table is unit-tested and real keys go on the manual checklist.
  - Several limits remain until managed deployment.
