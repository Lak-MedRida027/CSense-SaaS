# Manual gate and lockdown checklist (Windows)

Phase 5 plan section 7.6 and 11, ADR 0015 and ADR 0016. Run on a **real Windows 10/11 machine** with a packaged or
unpackaged build, signed in as an employee. Automated tests cover the key-filter decision table and the window state;
they cannot press real keys or use OS-level features. Record the result of every row in the PR (Pass / Blocked by
design / Not blockable / Fail) with the date, Windows build and Electron version.

Legend: **Expect: blocked** means CSense must stop it. **Expect: NOT blockable** means user space cannot stop it; the
row exists so the limit is observed and recorded, not so it can pass. A "Fail" on a *blocked* row is a bug. A change to
an *not blockable* row (it suddenly gets blocked) is also worth noting.

## A. Gate (window locked, before release)

| # | Action | Expect |
|---|---|---|
| A1 | Start the app. Is the gate shown full screen, above other windows, before any other UI? | Gate covers the screen |
| A2 | With two monitors: is the second display covered? Unplug and re-plug it | Covered; follows hot-plug |
| A3 | Alt+F4 | Blocked, gate stays |
| A4 | Click taskbar / try to minimise or move the window | Not possible (no taskbar entry) |
| A5 | Ctrl+W, Ctrl+R, F5, F11, F12, Ctrl+Shift+I | Blocked |
| A6 | Right-click anywhere except an email/password field on the Login step | No menu |
| A6b | Login step: paste a password with Ctrl+V, Shift+Insert and right-click > Paste (also from a password manager) | Works, into the email and password inputs only |
| A6c | Challenge step (after sign-in): Ctrl+V, Shift+Insert, right-click | Blocked, no menu |
| A7 | Tray: is there any Quit/Sign out while locked? | No |
| A8 | Sign out (Sign out link) | Returns to Login, still locked |
| A9 | Lock the screen (Win+L) and unlock | Gate is shown again if the clearance expired; re-checked otherwise |
| A10 | Sleep/resume | Same as A9 |
| A11 | Log off or shut down while the gate is up | **Never blocked** (Windows proceeds) |
| A12 | Disconnect the network, restart the app | Offline screen; "Continue offline" only after the grace period; re-locks when the network returns |
| A13 | Wrong answer x3 | Restricted screen with a `GATE-` reference; relaunch is still restricted |
| A14 | Restricted employee: close the app (Task Manager), disconnect the network, start CSense again, wait past the grace period | The Offline screen never shows "Continue offline" (D5-5 outranks D5-12) |
| A15 | Employee who was never restricted: block only the API (for example a bad per-user proxy), start CSense, wait 120 s, "Continue offline", then restore the proxy | Workstation re-locks when the API answers; the server shows an offline-release report for the user |
| A16 | Released as an administrator, then try to sign in as an employee (only possible through the bridge) | Refused; if it happens anyway the gate re-locks and asks the question |
| A17 | Answer the last gate question and sign out at the same moment | No grant for the signed-out session (late answers are dropped) |
| A18 | Login step, Arabic or Russian keyboard layout: Ctrl+V into the password field | Pastes (layout-independent V key); Ctrl+C and Ctrl+X still blocked |
| A19 | Console of a debug build: `iframe.contentWindow.close.call(window)` | The window closes, CSense restarts and shows the locked gate again within a few seconds |

## B. Quiz lockdown (active quiz)

| # | Action | Expect |
|---|---|---|
| B1 | Put text on the clipboard, start a secure quiz | Clipboard empty after entry |
| B2 | Ctrl+C on question text, Ctrl+V / Ctrl+X, Shift+Insert, Ctrl+Insert, right-click > Paste | Blocked (paste is allowed on Login only, never here); clipboard stays empty |
| B3 | Ctrl+P, Ctrl+S, Ctrl+O, Ctrl+N, Ctrl+T, Ctrl+F, Ctrl+G, Ctrl+U | Blocked |
| B4 | F1 to F12 (including F7 caret browsing), the Context Menu key, Shift+F10 | Blocked |
| B5 | Alt+F4, Alt+Space, Alt+Left, Alt+Right, Alt+Home | Blocked |
| B6 | Ctrl+Plus, Ctrl+Minus, Ctrl+0 | Zoom works |
| B7 | Tab / Shift+Tab / Enter / Space / arrows | Work (keyboard navigation, no trap) |
| B8 | Escape | Only closes the "Leave the quiz?" dialog; never exits lockdown |
| B9 | Keyboard only: Tab to **Exit quiz**, Enter, Tab to **Leave quiz**, Enter | Lockdown ends; clipboard works again |
| B10 | PrintScreen, Snipping Tool (Win+Shift+S), Xbox Game Bar capture, screen recording | Captured image of the CSense window is **black** (content protection). The tool opening is not blockable |
| B11 | Switch focus away (click another app via Alt+Tab) for under 0.5 s | Ignored |
| B12 | Lose focus 1 and 2 times (> 0.5 s each) | Warning in the banner; focus pulled back (best effort, the taskbar may only flash) |
| B13 | Lose focus a 3rd time, or stay away 15 s | Attempt ends as abandoned; workstation unlocked |
| B14 | Open a UAC prompt during a quiz | Counts as a focus loss (known, accepted risk 7) |
| B15 | Kill the renderer (Task Manager, "CSense" renderer process) once | Quiz screen restarts with a notice; still locked. Twice: attempt ends, unlocked |
| B15b | Close the window of a running quiz through the iframe trick above (debug build) | App restarts into the gate; after sign-in the attempt shows as abandoned (pending abandon replayed for the same user only) |
| B16 | Kill the main CSense process | All restrictions vanish with it; nothing persists. Next start is clean |
| B17 | Log off / shut down mid-quiz | **Never blocked** |
| B18 | Leave the quiz open past the time limit + 60 s | Lockdown ends by itself |
| B19 | Submit | Result shown, lockdown ends, clipboard cleared again |

## C. NOT blockable from user space (observe and record)

| # | Action | Expect |
|---|---|---|
| C1 | Ctrl+Alt+Del and Task Manager / Lock / Sign out from it | NOT blockable |
| C2 | Ctrl+Shift+Esc (Task Manager) | NOT blockable |
| C3 | Killing CSense from Task Manager or `taskkill` | NOT blockable; the gate returns at next logon, no clearance is recorded server-side for the day |
| C4 | Win key, Win+D, Win+Tab, Win+R, Win+L | NOT blockable |
| C5 | Win+V clipboard history | NOT blockable: earlier or synced entries can appear |
| C6 | Alt+Tab (the switcher opens; the always-on-top window stays visible, the blur policy applies) | NOT blockable |
| C7 | Remote desktop / VM capture, phone camera, second machine | NOT blockable |
| C8 | Accessibility tools (Narrator, Magnifier, on-screen keyboard) | Intentionally **not** blocked |

## D. Packaged build only

| # | Action | Expect |
|---|---|---|
| D1 | Start with `--remote-debugging-port=9222` or `--inspect` | App exits with code 2, no window |
| D2 | Set `CSENSE_API_BASE_URL=http://example.com/api/v1` before launch | Ignored (packaged builds read no `CSENSE_*`) |
| D3 | Settings > Apps > Startup | CSense is listed (per-user login item) and removable by the user; machine-wide, non-removable start is Phase 10 |
| D4 | Start a second instance | The first window is focused; no second gate |

Phase 10 narrows section C: Assigned Access, `NoWinKeys`, `DisableTaskMgr`, `AllowClipboardHistory=0`, AppLocker/WDAC and
a scheduled-task watchdog that relaunches CSense.
