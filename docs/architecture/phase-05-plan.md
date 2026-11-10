# Phase 5 plan: desktop shell, pre-access security gate, quiz kiosk lockdown

- Status: **Approved 2026-11-10.** D5-1 to D5-27 approved as recommended. The product owner explicitly confirmed D5-5 (restricted access is a full block until an administrator restores it) and D5-12 (fail open after 120 s with an explicit "Continue offline", re-lock as soon as the API answers).
- Branch: `phase-05-desktop-gate`, stacked on `phase-04-gamification-risk` (rebased onto `main` once PR 3 and PR 4 merge). Where this plan cites Phase 3/4 internals that later Phase 4 fixes changed, the implemented code wins.
- New ADRs (all Accepted 2026-11-10):
  - 0013 desktop process model and IPC bridge
  - 0014 desktop session and token store
  - 0015 pre-access security gate
  - 0016 quiz kiosk lockdown
  - 0017 risk model v2 (gate signals) and gate XP
  - 0018 Electron e2e backend harness
- Writes no feature code. Every item maps to a requirement in section 1, or is flagged in section 16.

## 0. Inputs read and the state this plan builds on
- `CLAUDE.md`: security baseline (kiosk/lockdown mode, token lifetimes, RBAC, audit on escalations) and the open questions.
- `BUILD_PLAYBOOK.md` Phase 5 (plan prompt, build prompt, gate).
- `docs/api/contract.md`: the gate routes reserved for Phase 5 (`GET /gate/status`, `POST /gate/attempts`, `POST /admin/users/:userId/restore-access`) and decision U15.
- `docs/architecture/data-model.md` lists "gate state (5)" as a planned addition.
- Phase 2, 3 and 4 plans and ADR 0001 to 0012, in particular:
  - ADR 0004: the refresh token is held only by the main process with `safeStorage`; refreshes must be single-flight; follow-up "Phase 5 ADR on main-process proxy".
  - ADR 0005: route registry and the central access gate.
  - ADR 0007: a 60-minute assessment session outlives the 15-minute access token.
  - ADR 0009: Defender needs behaviour XP beyond the course (the course maximum is 2,970).
  - ADR 0010 and Phase 4 D4-9: Behavioural blends gate 70 / conduct 30 in model v2.
  - ADR 0011: reason `gate_access_restricted` already exists (critical, management tier), and `governance.recordCriticalEvent` is the entry point.
- Desktop code:
  - `desktop/src/main/index.ts`: contextIsolation, sandbox, nodeIntegration off, window-open deny, will-navigate lock, permission deny, webview deny.
  - `desktop/src/preload`: the bridge exposes only `appVersion`.
  - Renderer screens: `SecurityGate` (`challenge` / `granted` / `restricted`), `Login`, and `Quiz` with `LockdownState` (`entering` / `active` / `exiting` / `failed`).
  - Layouts: `GateShell`, `LockdownShell`.
  - The CSP meta in `index.html` (`connect-src 'self' http://localhost:4000`).
  - `e2e/smoke.spec.ts`, which asserts the bridge keys are exactly `['appVersion']`.
- Server code:
  - `escalation.service.recordCriticalEvent` hard-codes `reviewTier: 'management'`.
  - `riskFacts.service` returns `gate: null`.
  - `authenticateBearer` selects `role isActive`.
  - `accessGate` enforces `access` only.
  - The reconcile markers and the sweeper.
- CI: the e2e job runs on `windows-latest` with no MongoDB today.

**Corrections to the brief:**
- The escalation reason already exists as `gate_access_restricted` (`shared/src/constants/governance.ts`, ADR 0011). This plan reuses it and adds no new `gate_restricted` reason.
- The "Phase 2 security review notes" I6 (https-only API URL) and D-10 (NAT/proxy) are not in the repo as a file. I6 is taken from the brief, and D-10 from `phase-02-plan.md` section 497/520.

## 1. Requirements in scope (traceability keys)
| Key | Requirement (source) |
|---|---|
| R1 | Show a pre-access security gate at start-up; grant full access only when the required interaction is completed (Needs, enforce awareness) |
| R2 | Limited retries, then a restricted-access state that alerts the security team (Needs; UC Escalate Restricted Access extends Interact with Security Gate) |
| R3 | Use case Interact with Security Gate **includes Authenticate** (UML) |
| R4 | Anti-cheating: kiosk/lockdown mode restricting shortcuts, clipboard and developer tools while a quiz is active (Needs; CLAUDE.md baseline) |
| R5 | Native OS notifications for training reminders (Needs NFR) |
| R6 | A desktop application in front of workstation access, not a voluntary web portal (Needs, constraint) |
| R7 | Token baseline: access ~15 min, refresh ~7 days in an httpOnly-equivalent store, rotated on use (CLAUDE.md; ADR 0004) |
| R8 | Every risk escalation writes an immutable audit entry (CLAUDE.md) |
| R9 | Behavioural risk dimension sources gate signals (ADR 0010, D4-9) |
| R10 | XP and level ladder; Defender reachable only through sustained behaviour (ADR 0009, D4-1) |
| R11 | Electron hardening: contextIsolation, no nodeIntegration, sandbox, minimal typed preload (playbook; ADR 0001) |
| R12 | WCAG 2.1 AA (Phase 1 targets), in particular 2.1.2 No Keyboard Trap |
| G | Playbook gate: the app launches into the gate and refuses access until the interaction is done; retry exhaustion gives the restricted state; quiz lockdown is active and the obvious escapes fail; `/verify` green |

Out of scope, by phase:
- Phase 6: full employee journey UI (dashboard, module player, onboarding, the final-assessment entry UI).
- Phase 7: the admin console UI, including restore-access UI and the escalation OS notification.
- Phase 7: admin gate-question authoring.
- Phase 9: the adversarial pass.
- Phase 10: packaging, code signing, Electron fuses applied to the installer, managed-fleet enforcement.

## 2. How "sitting in front of workstation access" is achieved, honestly (R1, R6)
CSense is a user-space application. It **cannot replace or precede the Windows logon**:
- A real pre-logon gate is a Windows Credential Provider, a native COM DLL in LogonUI. Electron cannot be one.
- Ctrl+Alt+Del (the secure attention sequence) can never be intercepted by an application.

What Phase 5 delivers is a **post-logon, pre-use** gate:

| Layer | Phase 5 (this plan) | Deferred to Phase 10 (managed fleet) |
|---|---|---|
| Start at login | Packaged builds register a per-user login item (`app.setLoginItemSettings({ openAtLogin: true, args: ['--autostart'] })`, the HKCU Run key). Users can remove it in Settings → Startup apps. | Machine-wide start (HKLM Run, or a Scheduled Task "at logon" with restart-on-failure), deployed by GPO or Intune. Standard users cannot remove it. |
| Single instance | `app.requestSingleInstanceLock()`. A second launch focuses the existing gate. | n/a |
| Cover the screen | The gate window is created **before any network call**: frameless, `kiosk`, full screen, `alwaysOnTop('screen-saver')`, not closable, minimisable or movable, `skipTaskbar`. A non-interactive cover window is placed on every other display, and hot-plugged displays are covered too. | Windows Assigned Access or Shell Launcher (kiosk policies) for locked-down roles. |
| Close attempts | Close is prevented while locked: the `close` event calls `preventDefault`, Alt+F4 is filtered, and there is no Quit in the tray while locked. `before-quit` is refused while locked **except during OS logoff or shutdown** (`session-end` on Windows, `powerMonitor 'shutdown'`). | n/a |
| Process kill (Task Manager, `taskkill`) | **Cannot be prevented from user space.** The gate returns at the next logon. Because the server has no clearance for the day, the missing pass is visible to administrators (Phase 7 compliance view). | `DisableTaskMgr` policy, AppLocker or WDAC, a scheduled-task watchdog that relaunches CSense, and alerting on missing daily clearances. |
| Screen lock, sleep | On `unlock-screen` and `resume` (powerMonitor), main re-checks gate status; if the clearance expired, the gate comes back. | n/a |
| Offline or API down | Decision D5-12 (fail open after a grace period, then re-gate on reconnect). | Fleet policy may choose fail-closed. |

This framing goes into ADR 0015 and the README so nobody oversells the control. The gate enforces **awareness at the workstation for cooperative and casually curious users**. It is not a security boundary against a determined local user with Task Manager. The server-side record (who passed, who failed, who never showed up) is the defensible part.

## 3. Architecture overview
```
                +--------------------------- Electron main (trusted) ---------------------------+
                | config (API URL policy)  logger (redacting)  AppLock (window/kiosk primitives) |
                | IpcRegistry (zod, sender check) -> handlers                                    |
                | SessionService -> TokenStore (memory + safeStorage file)                       |
                | ApiClient (session.fetch on partition 'csense-api', bearer, single-flight)     |
                | GateController (state machine, clearance timer, covers, offline policy)        |
                | LockdownController (session-bound, input filter, clipboard, focus, recovery)   |
                | ReminderScheduler (Notification)   Tray   AutoStart                            |
                +-------^--------------------------------------------------------------+---------+
                        | ipcRenderer.invoke('csense:v1:<channel>', input)              | 'csense:v1:event'
                +-------+---------- preload (sandboxed, contextBridge) ----------------v---------+
                | window.csense (frozen, typed, versioned): session, gate, assessment, learning, |
                |                                         events.subscribe                       |
                +-------^------------------------------------------------------------------------+
                        |
                +-------+---------- renderer (untrusted, app://csense) ----------+
                | React: Boot -> Login -> SecurityGate -> TrainingHome (min.) -> Quiz |
                +----------------------------------------------------------------+
```
- **The renderer never holds a token and never talks to the network.** CSP `connect-src 'self'` applies, and a main-side egress filter on the UI session blocks everything else.
- **Main is the only API client** (ADR 0014). This closes the ADR 0004 follow-up.

## 4. Main process and preload bridge (R11; ADR 0013)

### 4.1 BrowserWindow and session hardening (all windows)
- `webPreferences`:
  - `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `nodeIntegrationInWorker: false`, `webSecurity: true`
  - `webviewTag: false`, `spellcheck: false`, `navigateOnDragDrop: false`, `safeDialogs: true`
  - `devTools: devToolsAllowed` (below)
  - Only the main window has a preload. Cover windows load a static local page with **no preload**.
- **devToolsAllowed** = `!app.isPackaged && config.devToolsInDev`.
  - It is **forced false while the gate is locked or lockdown is active**, even in development: `closeDevTools()` runs on lock, and a `devtools-opened` event triggers an immediate close and counts as a violation.
  - The e2e run sets `devToolsInDev=false` (section 12.5) so it exercises the production behaviour.
- **Custom protocol (D5-20).**
  - Register `app` as a privileged standard, secure scheme and serve `out/renderer` through `protocol.handle('app', ...)`.
  - Normalise the path, reject `..`, encoded separators, absolute paths and anything outside the bundle root, and return 404 otherwise.
  - Production loads `app://csense/index.html`. Development keeps the electron-vite dev URL.
  - Replaces `file://`, per the Electron security checklist item "avoid file://".
- **Navigation locks:**
  - Keep the `will-navigate` deny, and add `will-frame-navigate` and `will-redirect` denies.
  - Allowed: the same origin (`app://csense`, or the dev-server origin when unpackaged).
  - `setWindowOpenHandler` always returns `{ action: 'deny' }`. `shell.openExternal` is used only for https URLs on an allowlist (`config.externalLinkHosts`, empty by default), so the gate's "Contact security team" uses in-app text, not links.
  - `app.on('web-contents-created')` applies the same handlers to every webContents.
- **Permissions:**
  - Keep `setPermissionRequestHandler` deny, and add `setPermissionCheckHandler` → false and `setDisplayMediaRequestHandler` → deny.
  - Web `Notification` is denied: only main shows notifications.
  - `select-usb-device`, `select-hid-device`, `select-serial-port` and `select-bluetooth-device` are denied.
- **Egress filter.**
  - The UI uses the default session, where `webRequest.onBeforeRequest` cancels any URL whose scheme or origin is not `app://csense`, `devtools://` (development only) or the dev-server origin (unpackaged).
  - The API client uses a **separate in-memory session** (`session.fromPartition('csense-api')`, no `persist:`) through `ses.fetch`, so the filter never affects it and the renderer can never reach it.
  - Phase 6 adds the media host to the UI-session allowlist and `media-src`.
- **TLS.**
  - `app.on('certificate-error')` never calls `callback(true)`: default deny, logged.
  - Corporate proxies and TLS-inspection roots work because `session.fetch` uses Chromium's network stack with the system proxy and the OS trust store (relevant to D-10).
- **Command line.** In packaged builds, refuse to start (exit code 2, logged) if `--remote-debugging-port`, `--inspect`, `--inspect-brk`, `--remote-allow-origins` or `--js-flags` is present.
  - Fuses (`RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments`, `OnlyLoadAppFromAsar`, `EnableEmbeddedAsarIntegrityValidation`, `EnableCookieEncryption`) are flipped by the Phase 10 packaging step.
  - Phase 5 writes `desktop/build/fuses.config.ts` and a unit test of its values; nothing applies it yet, because Playwright needs the inspector on unpackaged builds.
- **Development relaxations are keyed on `app.isPackaged === false` only, never on an environment variable alone** (security property S2).

### 4.2 Configuration and the API URL policy (I6)
`desktop/src/main/config.ts` is a pure function `loadDesktopConfig(source, { isPackaged })`, unit-tested.

| Key | Source | Rule |
|---|---|---|
| `apiBaseUrl` | build-time `MAIN_VITE_API_BASE_URL`. When unpackaged only, the runtime `CSENSE_API_BASE_URL` overrides it (e2e). | Parsed with `new URL`. No username or password, no query, no fragment. The path must end with `/api/v1`. **Packaged: `https:` only.** **Unpackaged: `https:`, or `http:` only when the host is `localhost`, `127.0.0.1` or `[::1]`.** Anything else (including `http://192.168.x.x`) is refused. |
| `userDataDir` | `CSENSE_USER_DATA_DIR`, unpackaged only | e2e isolation (`app.setPath('userData')` before ready) |
| `gateOfflinePolicy`, `gateOfflineGraceSeconds` | `MAIN_VITE_GATE_OFFLINE_POLICY` (`open_after_grace` \| `closed`), `MAIN_VITE_GATE_OFFLINE_GRACE_SECONDS` (30..900, default 120) | D5-12 |
| `gateRestrictedPollSeconds` | constant 60. When unpackaged, `CSENSE_GATE_POLL_SECONDS` (2..600) is honoured. | restricted and offline re-check |
| `lockdownMaxFocusLosses`, `lockdownFocusAwaySeconds` | `MAIN_VITE_LOCKDOWN_MAX_FOCUS_LOSSES` (1..10, default 3), `MAIN_VITE_LOCKDOWN_FOCUS_AWAY_SECONDS` (5..120, default 15) | D5-15 |
| `autoStart` | `MAIN_VITE_AUTOSTART` (default true), effective only when packaged | D5-23 |
| `reminders` | `MAIN_VITE_REMINDER_FIRST_DELAY_MINUTES` (default 120), `MAIN_VITE_REMINDER_INTERVAL_MINUTES` (default 240), `MAIN_VITE_REMINDER_MAX_PER_DAY` (default 2) | D5-21 |
| `devToolsInDev` | `CSENSE_DEVTOOLS`, unpackaged only (default true) | |

- **Refusal behaviour.** On an invalid config, main still creates the locked gate window (the workstation stays covered under the offline policy) and shows a "CSense is misconfigured, contact IT" state. It makes **no network request** and writes one log line.
- Packaged builds never read `CSENSE_*` runtime variables. A unit test proves that each one is ignored when `isPackaged` is true.

### 4.3 CSP (renderer `index.html`)
```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
font-src 'self'; connect-src 'self'; media-src 'none'; object-src 'none'; frame-src 'none';
worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```
- `http://localhost:4000` is removed from `connect-src`: the renderer no longer calls the API.
- `default-src` is tightened to `'none'`.
- `style-src 'unsafe-inline'` stays, because CSS Modules plus Vite inject `<style>` in dev. Phase 9 should evaluate hashes or nonces.
- Development: electron-vite HMR needs `ws:` to the dev origin. A dev-only meta variant is produced by an electron-vite `transformIndexHtml` hook keyed on `mode === 'development'`, so the production bundle never contains `ws:`.
- Phase 6 adds `media-src https://<media host>`.
- Main also sets the same CSP as a response header in the `app://` protocol handler (defence in depth; headers beat meta).

### 4.4 IPC contract (preload bridge v1)
**Principles:**
- One `ipcRenderer.invoke` channel per method, named `csense:v1:<area>.<method>`.
- One push channel, `csense:v1:event`.
- **No generic passthrough:** there is no `invoke(channel, ...)` exposed, and no "call any API path".
- Every channel is declared in a main-side `IpcRegistry` (mirrors ADR 0005): `{ channel, input: zod schema (strict), handler }`.
- `assertIpcRegistry()` at start-up throws if a channel lacks a schema, is duplicated, or the preload channel list differs from the registry. The lists come from one shared constant `IPC_CHANNELS_V1` in `desktop/src/shared/ipc.ts`, typed.
- **Sender validation** on every invoke:
  - `event.senderFrame` must be the main window's top-level frame (`frame === mainWindow.webContents.mainFrame`), not a subframe.
  - Its URL origin must be the app origin.
  - Otherwise the call is rejected with `{ ok: false, error: { code: 'FORBIDDEN_SENDER' } }` and logged.
- **Results are values:** `type Result<T> = { ok: true; data: T } | { ok: false; error: { code: DesktopErrorCode; message: string; retryAfterSeconds?: number; details?: { retryAt?: string } } }`.
  - Thrown errors never cross IPC, so main-side stack traces never reach the renderer.
  - `code` is either a server error code (shared `ERROR_CODES`) or a desktop code: `NETWORK_UNAVAILABLE`, `SESSION_EXPIRED`, `NOT_SIGNED_IN`, `LOCKDOWN_REQUIRED`, `LOCKDOWN_NOT_ACTIVE`, `GATE_LOCKED`, `INVALID_INPUT`, `FORBIDDEN_SENDER`, `BAD_RESPONSE`, `MISCONFIGURED`.
- **Input bounds.**
  - Every string has a max length: email 254, password 72 UTF-8 bytes (shared `passwordSchema` bounds), ids are 24-hex ObjectIds.
  - The answers array has at most 50 items.
  - IPC payloads over 64 KB are rejected before parsing.
- **Rate guard.** Per channel, at most 20 calls per second; beyond that `INVALID_INPUT` is returned and logged. This stops a compromised renderer from turning main into a request amplifier.
- **Events** are delivered to the subscriber as **payload only**; the `IpcRendererEvent` object is never passed through. `subscribe` returns an unsubscribe function.

`window.csense` (frozen; `bridge.d.ts` updated):
```ts
interface CSenseBridgeV1 {
  readonly bridgeVersion: 1;
  readonly appVersion: string;
  session: {
    getState(): Promise<SessionView>;   // { status: 'unknown'|'signed_out'|'signed_in', user?: { id, name, role, level?, totalXP? }, persistence: 'encrypted'|'memory_only' }
    login(input: { email: string; password: string }): Promise<Result<SessionView>>;
    logout(): Promise<Result<void>>;
  };
  gate: {
    getView(): Promise<GateView>;       // main's gate state machine (section 6.6), incl. GateStatusDTO data when known
    requestChallenge(): Promise<Result<GateView>>;
    submitAnswer(input: { challengeId: string; optionIndex: number }): Promise<Result<GateAnswerView>>;
    continue(): Promise<Result<void>>;  // release; succeeds only if main itself saw 'granted' from the server
    continueOffline(): Promise<Result<void>>; // only when main is in 'offline_grace_elapsed'
  };
  assessment: {
    startSecure(input: { kind: 'quiz'; moduleId: string } | { kind: 'final' }): Promise<Result<SecureSessionView>>;
    resume(): Promise<SecureSessionView | null>;     // after a renderer reload during lockdown
    submit(input: { sessionId: string; answers: { questionId: string; selectedIndex: number | null }[] }): Promise<Result<AttemptResultDTO>>;
    exit(input: { sessionId: string }): Promise<Result<{ attempt: AttemptResultDTO | null }>>; // never blocked
  };
  learning: {                            // Phase 5 minimal read surface; Phase 6 extends this list
    getOverview(): Promise<Result<LearningOverviewDTO>>;              // GET /modules
    getQuizOverview(input: { moduleId: string }): Promise<Result<QuizOverviewDTO>>; // GET /modules/:id/quiz
  };
  events: { subscribe(listener: (e: MainEvent) => void): () => void };
}
type MainEvent =
  | { type: 'session'; view: SessionView }
  | { type: 'gate'; view: GateView }
  | { type: 'lockdown'; state: 'inactive'|'entering'|'active'|'exiting'|'failed'; sessionId: string | null }
  | { type: 'lockdown-violation'; kind: 'focus_lost'|'devtools'|'blocked_shortcut'; count: number; remaining: number }
  | { type: 'navigate'; to: 'home' | { module: string } };   // from notification clicks; renderer allowlists targets
```
- The channel inventory (15 invoke channels plus 1 event channel) is snapshot-tested, so any new channel shows up as a reviewed diff (S5).
- Responses returned to the renderer are parsed with the **shared strict response schemas** (`learningResponses`, the new `gateResponses`) before crossing IPC. Extra fields, or a token-shaped field, give `BAD_RESPONSE`.
- **Password handling:** the password crosses IPC once, at `session.login`. Main forwards it to `/auth/login` and drops the reference. It is never logged and never stored.

### 4.5 Window model and lifecycle
- **One main window.** It starts **locked** (gate) and becomes a normal window after release.
  - Release = leave kiosk mode, leave always-on-top, become closable, restore 1280x800 centred.
  - Re-lock = the same primitives in reverse.
- The `AppLock` primitive (`desktop/src/main/lock/appLock.ts`) owns:
  - `lock(profile: 'gate'|'lockdown')` and `unlock()`
  - the cover windows
  - the input filter
  - the close guard
  - `GateController` and `LockdownController` both use it.
  - The two profiles differ only in clipboard handling, content protection and the shortcut allowlist.
- **Tray** (D5-22): created after the first release. Menu: Open CSense, Sign out, Quit. Quit is shown only while unlocked.
  - Closing the released window hides it to the tray, so reminders and clearance timers keep running.
- **Clearance timer:** when the server returns `clearedUntil`, main schedules a re-lock at that time.
  - If lockdown is active then, the re-lock waits until lockdown exits.

## 5. Secure token store and API client (R7; ADR 0014)

### 5.1 TokenStore (`desktop/src/main/session/tokenStore.ts`)
- **Access token:**
  - Lives in main memory only (`{ token, expiresAt }`).
  - Never persisted, never logged, never sent over IPC.
- **Refresh token:**
  - Kept in main memory.
  - Persisted **only** when `safeStorage.isEncryptionAvailable()` is true **and** `getSelectedStorageBackend()` is not `'basic_text'` (Linux).
  - Storage: `userData/session.v1.json` = `{ v: 1, userId, refreshTokenExpiresAt, blob: base64(safeStorage.encryptString(refreshToken)) }`.
  - Written atomically (temp file plus rename).
  - Read only after `app.whenReady()`.
- **Fallback (D5-13):** when encryption is unavailable, the session is **memory-only**. The user signs in on each launch, and `SessionView.persistence = 'memory_only'` lets the UI say so. **Nothing is ever written in plaintext.** No downgrade path and no flag override exist (S7).
- **Corrupt or undecryptable file** (another OS user, or a DPAPI key change): delete it, start signed out, log the event without the content.
- **Expired** `refreshTokenExpiresAt` on load: delete the file, start signed out.

### 5.2 ApiClient (`desktop/src/main/api/client.ts`)
- **Operations are a closed table** (`api/operations.ts`): `{ id, method, path(params), inputSchema, responseSchema, auth: 'none'|'bearer'|'refresh' }`.
  - Path params are validated ObjectIds and inserted with `encodeURIComponent`.
  - Phase 5 operations: `auth.login`, `auth.refresh`, `auth.logout`, `auth.me`, `gate.status`, `gate.challenge`, `gate.attempt`, `modules.list`, `modules.quizOverview`, `quiz.startSession`, `quiz.submit`, `quiz.abandon`, `final.startSession`, `final.submit`, `final.abandon`.
  - The base URL is fixed by config.
- **Requests:**
  - `Authorization: Bearer` is attached from memory.
  - Request timeout is 15 s (login 30 s, to cover the failed-login floor).
  - JSON only. Request bodies are capped at 64 KB and response bodies at 2 MB.
- **Single-flight refresh:**
  - One in-flight `refreshPromise`. Every caller that needs a refresh awaits it.
  - A refresh starts when the access token has under 60 s left, or after a 401 `UNAUTHENTICATED` (one refresh, then one retry of the original request).
  - A 401 means the server did not process the request, so retrying a POST is safe.
  - No retry on any other status.
- **During lockdown** a proactive refresh timer runs at `expiresAt - 120 s`, so a submission 59 minutes in never waits on a refresh (ADR 0007).
- **Rotation persistence:** the new refresh token is persisted **before** the refresh promise resolves.
  - If main crashes between the server rotation and the write, the next launch presents the old token. That is reuse detection: the server revokes the family and the user signs in again.
  - This is accepted. It is the secure outcome, and it is documented.
- **`INVALID_REFRESH_TOKEN`**, or a 401 after refresh:
  - Wipe memory and file, emit `session: signed_out`.
  - Re-lock the gate (not mid-lockdown: see 7.7).
  - The renderer shows Login with "Your session ended. Please sign in again."
- **Logout:**
  - If lockdown is active, `assessment.exit` runs first.
  - Then `POST /auth/logout` with `{ refreshToken }`, best effort with a 5 s timeout.
  - Memory and file are wiped **regardless of the network result**.
  - Then the gate re-locks.
- **Revocation** (admin deactivation, reuse detection elsewhere) is discovered on the next request or refresh and handled as above.
- **Why a main-process proxy** rather than handing the access token to the renderer (D5-14, ADR 0014):
  1. An XSS in the renderer cannot exfiltrate a bearer token for use from another machine. It can only call allowlisted operations while the app runs, with egress blocked.
  2. Single-flight refresh and token rotation live in one place, satisfying ADR 0004 D-4.
  3. Main must observe session starts to validate lockdown (section 7.1) and gate grants to release (6.6).
  4. CSP and egress filtering can deny all renderer network access.

  Cost: an IPC hop (negligible), and each new route needs an operation entry, which is reviewable by design.

### 5.3 Logging
`desktop/src/main/log.ts`:
- JSON lines in `userData/logs/main.log`, rotated at 1 MB x 3 files.
- A redaction list (`authorization`, `accessToken`, `refreshToken`, `password`, `answers`, `selectedIndex`, `optionIndex`, `blob`) is applied to every object logged.
- Unit-tested.

## 6. The pre-access security gate (R1, R2, R3, R8, R9, R10; ADR 0015)

### 6.1 Placement: pre-access, post-authentication (resolves U15; D5-1)
- The gate **window** is up from the first frame of start-up, before any network call and before sign-in.
- The **challenge** is served only after authentication. The UML says Interact with Security Gate *includes* Authenticate, and the Phase 1 stepper is Sign in → Security check → Access granted.
- **Why the challenge is not anonymous:**
  - The server needs an identity to count attempts, restrict, escalate, feed Behavioural risk and award XP.
  - An anonymous, per-workstation counter is client-held and therefore resettable.
  - Restricting "whoever typed this email" would hand anyone a lever to lock out a colleague and fire a critical escalation against them.
- **Failed logins never count as gate attempts** (S14). They stay with the Phase 2 limiters and the `auth.login.account_targeted` signal.
- The contract annotation "employee (pre-auth flow per U15)" is reworded to "employee (gate: pre-access, post-authentication; U15)".
- **Persisted session (D5-13):** a persisted session resumes silently at start-up, so the Sign-in step shows as complete. Credentials are re-entered at least every 7 days (absolute refresh lifetime), and whenever encryption is unavailable.
- **Administrators (D5-11):** an administrator sign-in releases the gate without a challenge. `/gate/*` stays employee-only, and an administrator's day-to-day use is the console (Phase 7). Phase 5 shows an "Admin console arrives in a later release" placeholder after release.

### 6.2 The required interaction (D5-2)
- **One awareness question** drawn from a dedicated **gate question pool**. It is separate from the quiz pools, so the gate never leaks module quiz keys.
- Answering correctly grants access.
- **Each attempt serves a different question.** After a wrong answer the employee sees "Not quite" plus the explanation, and the next attempt is a new question.
  - This closes the trivial bypass: with 3 options and 3 attempts on one question, elimination always passes.
  - The correct option index is **never** returned, on a correct or a wrong answer.
  - Explanations follow the ADR 0007 authoring rule: teach the concept without naming the option.
- **Selection** reuses `selectQuestionIds(pool, history, 1, shuffle)` from `@csense/shared`:
  - It prefers questions this employee has not been served in their last 30 served questions, then the least recently served.
  - Within a run it never repeats a question.
- **Pool rules:**
  - Questions have 3 to 6 options.
  - At least `GATE_MAX_ATTEMPTS` active questions are required to serve a run. Otherwise the response is 503 `GATE_UNAVAILABLE` (6.8).
  - The dev/test seed ships 30 generic questions.
  - Authoring is Phase 7. The shared `gateQuestionAuthoringSchema` lands now (strict; https-free plain text; explanation required).

### 6.3 Attempts, runs, clearance (D5-3, D5-4)
- A **gate run** is one pass-or-restrict episode.
  - At most one run per employee is open (partial unique index).
  - A run stays open across app restarts, sign-outs and new sessions until it is **passed** or **restricted**. Restarting the app never resets attempts (S12).
  - Attempts are counted per run: `GATE_MAX_ATTEMPTS` (default 3, range 1..10, snapshotted on the run).
  - The wrong answer that uses the last attempt restricts the run.
- **Clearance.** A pass sets `clearedUntil = passedAt + GATE_CLEARANCE_TTL` (default 12h, range 5m..24h). While cleared:
  - status is `granted`
  - `POST /gate/challenge` opens nothing
  - the desktop shows "Access granted" at start-up and auto-continues after 2 s (`autoContinueMs`, with the "Continue now" button always shown)
- **When the gate is required:** the gate is **shown** at every start-up, unlock and resume. A **new question** is required once the last clearance has expired, which in practice means once per working day per employee, on whichever workstation they use first.
- Alternative (D5-4): a question on every launch. Rejected as the default: restarts after crashes and updates would force repeated questions, gate fatigue undermines the awareness goal, and "every launch" cannot be enforced server-side anyway.

### 6.4 Server: data model (new collections; `data-model.md` updated)
**`gatequestions` (GateQuestion):**
- `prompt` (required, 1..1000, clean text)
- `options` (String[3..6], each 1..300)
- `correctAnswer` (int index, `select: false`, `0 <= i < options.length`)
- `explanation` (required, 1..1000, `select: false`)
- `topic` (optional, max 60)
- `isActive` (default true)
- timestamps; `strict: 'throw'`
- Index: `{isActive:1}`.

**`gateruns` (GateRun, mutable, compare-and-set):**

| Field | Type | Rules |
|---|---|---|
| userId | ObjectId → User | required (employee) |
| status | `open` \| `passed` \| `restricted` | default `open` |
| maxAttempts | int 1..10 | snapshot of `GATE_MAX_ATTEMPTS` |
| attemptsUsed | int ≥ 0 | |
| current | `{ challengeId: ObjectId, questionId: ObjectId, optionCount: int, correctAnswer: int (select:false), servedAt: Date }` or null | null once closed |
| servedQuestionIds | ObjectId[] (≤ 10) | in served order |
| firstAnswerCorrect | Boolean or null | set by the first answer |
| openedAt, closedAt | Date / Date or null | |
| clearedUntil | Date or null | set on pass |
| escalationId | ObjectId or null | set after restriction |
| restoredAt, restoredBy | Date / ObjectId or null | set by the admin restore (the run stays `restricted`: history) |
| version | int | +1 per change |

- `toJSON` never emits `current.correctAnswer`.
- Indexes:
  - `{userId:1}` **unique, partial `status: 'open'`** (one open run)
  - `{userId:1, closedAt:-1}`
  - `{userId:1, status:1, clearedUntil:-1}`
  - `{status:1, restoredAt:1}` (reconcile scan of unrestored restrictions)

**`gateanswers` (GateAnswer, append-only via the `appendOnly` plugin):**
- `userId`, `runId`, `attemptIndex` (1..maxAttempts), `challengeId`, `questionId`, `selectedIndex`, `correct`, `answeredAt`.
- Indexes: `{runId:1, attemptIndex:1}` **unique**; `{userId:1, answeredAt:-1}`.
- This is the record of truth for risk and XP. It is rebuildable, as in ADR 0009 and 0010.

**`users` (Employee discriminator), new field:**
- `gateRestriction: { restrictedAt: Date, runId: ObjectId } | null`, default null.
- It is a **cache** of "the latest restricted run is not restored", read by the access gate on every request (it already loads the user, D-5).
- Reconcile repairs it from `gateruns` (6.7).

The start-up index verification (`db/learningIndexes.ts`, renamed `db/requiredIndexes.ts` or extended) adds the two unique gate indexes; `/health/ready` reports not-ready without them.

### 6.5 Server: routes and DTOs (`server/src/features/gate/`)
| Method | Route | Access | Body | Success | Errors |
|---|---|---|---|---|---|
| GET | `/gate/status` | employee, `allowWhileRestricted` | none (strict empty query) | 200 `GateStatusDTO` (pure read, never creates a run) | 401, 403 (admin) |
| POST | `/gate/challenge` | employee, `allowWhileRestricted` | none | 200 `GateStatusDTO`. Get-or-create the open run's current challenge; idempotent (same `challengeId` until answered); opens nothing when `granted` or `restricted`. | 503 `GATE_UNAVAILABLE` |
| POST | `/gate/attempts` | employee | `{ challengeId, selectedIndex }` strict | 201 `GateAttemptResultDTO` | 400 (shape, index out of range for the served question: nothing consumed), 409 `GATE_CHALLENGE_STALE` (not the current challenge: replay, race loser, closed run), 403 `ACCESS_RESTRICTED` |
| POST | `/admin/users/:userId/restore-access` | admin | `{ note }` (1..2000, `isCleanText`) | 200 `RestoreAccessDTO { userId, runId, escalationId, restoredAt }` | 400, 404 (unknown or not an employee), 409 `NOT_RESTRICTED`, 409 `ESCALATION_NOT_ACKNOWLEDGED` (D5-7) |

`POST /gate/challenge` is **new** (not in the reserved contract). Keeping `GET /gate/status` free of side effects is worth one extra route. It is flagged in section 16.

```ts
GateStatusDTO = {
  state: 'required' | 'challenge' | 'granted' | 'restricted',
  maxAttempts: number, attemptsRemaining: number,
  challenge: { challengeId: string, prompt: string, options: string[] } | null,   // only in 'challenge'
  clearedUntil: string | null,                                                    // only in 'granted'
  restricted: { referenceId: string, since: string } | null,                      // only in 'restricted'
}
GateAttemptResultDTO = { correct: boolean, explanation: string, xpEarned: number, status: GateStatusDTO }
```
- `referenceId` = `GATE-<YYYYMMDD in ORG_TIMEZONE>-<last 6 hex of runId, upper case>`. It matches the UI fixture format. Administrators find the run through `escalation.sourceRef.id = runId`.
- All four schemas are strict and live in `shared/src/schemas/gate.ts` and `gateResponses.ts`.
- A deep-scan test asserts that no gate response ever contains `correctAnswer`, `correctIndex` or `isCorrect` for an option.

**`POST /gate/attempts` algorithm (no transactions, as D3-23):**
1. Load the open run of the caller. If none, or `current.challengeId !== body.challengeId`, return 409 `GATE_CHALLENGE_STALE`.
2. Validate `selectedIndex < current.optionCount` (400 otherwise; nothing consumed).
3. `correct = selectedIndex === current.correctAnswer`.
4. Decide the outcome:
   - `pass` if correct
   - `restrict` if wrong and `attemptsUsed + 1 === maxAttempts`
   - otherwise `next`, which draws the next question **before** the write
5. **Compare-and-set:** `findOneAndUpdate({ _id, status: 'open', 'current.challengeId': challengeId, attemptsUsed: n }, { $set: outcome fields, $inc: { attemptsUsed: 1, version: 1 }, $push: { servedQuestionIds } })`.
   - Pass: `status: 'passed', clearedUntil, closedAt, current: null`.
   - Restrict: `status: 'restricted', closedAt, current: null`.
   - Next: a new `current` with a fresh `challengeId`.
   - `firstAnswerCorrect` is set when n = 0.
   - A null result means 409 `GATE_CHALLENGE_STALE`: the concurrent submit lost, which is S13.
6. Insert the `GateAnswer`. A duplicate key here is ignored, because the compare-and-set already decided.
7. On **pass**: recompute XP (6.9) and risk (trigger `gate_run`, refId runId). Failures write a reconcile marker (reason `gate`) and **never** fail the response, as ADR 0008 requires.
8. On **restrict**, in this order:
   1. `User.updateOne({ _id, role: 'employee' }, { $set: { gateRestriction: { restrictedAt, runId } } })` (retry once, then marker).
   2. `escalations.recordCriticalEvent({ userId, reason: 'gate_access_restricted', sourceRef: { type: 'gate_event', id: runId }, occurredAt })`. This writes `governance.critical_event_recorded` (critical), opens the escalation (dedupe `gate_access_restricted:gate_event:<runId>`, so it is exactly once) and notifies through `SecurityTeamNotifier`.
   3. Set `run.escalationId`.
   4. Risk recompute (trigger `critical_event`, refId runId).

   Each step after the compare-and-set is idempotent. A failure writes a reconcile marker (reason `gate`). **The 201 response always reports the restricted state**, because the run is the record of truth.
9. Return 201 with the explanation and the new status.

**Server enforcement of the restricted state (D5-8; S10):**
- `AuthContext` gains `accessRestricted: boolean`. `authenticateBearer` selects `role isActive gateRestriction`, so the cost is unchanged.
- `RouteDef` gains an optional `allowWhileRestricted?: true`. `assertRouteDefs` accepts it only on `employee` or `authenticated` routes.
- The access gate, after the role check: if `auth.role === 'employee' && auth.accessRestricted && !def.allowWhileRestricted`, return 403 `ACCESS_RESTRICTED`.
- Allowed while restricted: `GET /auth/me`, `GET /config/features`, `GET /gate/status`, `POST /gate/challenge`. `/auth/refresh` and `/auth/logout` are public-level and unaffected.
- Every learning, gamification and other employee route answers 403.
- A route-inventory test asserts exactly this allowlist.
- **Clearance itself is not enforced on the learning API** (D5-8 default).
  - Reason: the gate controls the workstation, which only the client can cover. The server is authoritative for pass/fail, attempts and restriction.
  - Requiring a clearance on every learning route would re-plumb every Phase 3/4 test and break quizzes that straddle clearance expiry.
  - Alternative: 403 `GATE_REQUIRED` on employee routes without a valid clearance.

**Restore (D5-7):**
1. Load the employee (404 if absent or not an employee) and their latest restricted run with `restoredAt: null` (409 `NOT_RESTRICTED` if none).
2. Load the escalation. If its status is `open`, return 409 `ESCALATION_NOT_ACKNOWLEDGED`: someone must look before the lock is lifted. With `ESCALATION_REQUIRE_SECOND_ADMIN` the acknowledging and restoring admin may be the same person; restore does not resolve.
3. Compare-and-set the run (`restoredAt: null` → set `restoredAt`, `restoredBy`).
4. Clear `User.gateRestriction` where `gateRestriction.runId` equals that run.
5. Audit `gate.access_restored`: `warning`, actor admin, target user, metadata `{ runId, escalationId, noteSha256, noteLength }`; the note text goes on the escalation only, as in ADR 0011.
6. Append a `note` event to the escalation through `escalations.transition(..., { action: 'note', note })` (outbox-audited).
7. Return 200.
- The next `POST /gate/challenge` opens a **new** run with full attempts.
- The escalation stays open or acknowledged until resolved under the ADR 0011 rules.
- Phase 7 builds the UI. Phase 5 ships the route, its tests, and an e2e step that calls it over HTTP.

### 6.6 Desktop gate state machine (`desktop/src/main/gate/gateController.ts`)
```
boot ──(window locked, covers up)──> resolving_session
resolving_session ──no session──> signed_out (Login)        ──login ok──> checking
resolving_session ──refresh ok──> checking                  ──network down──> offline
checking ──employee──> GET /gate/status
     required ──> POST /gate/challenge ──> challenge
     challenge ──answer──> challenge (attempts--) | granted | restricted
     granted ──continue() or auto──> released (unlock window, tray, timers)
     restricted ──poll every 60 s──> restricted | required (after restore) ──> challenge
checking ──administrator──> granted_admin ──continue──> released
offline ──retry every 15 s──> checking ; after grace ──> offline_grace_elapsed ──continueOffline()──> released_offline
released / released_offline ──(clearedUntil reached | unlock-screen/resume with expired clearance | reconnect while released_offline | session ended)──> checking (re-lock)
```
- **Main decides release.** `gate.continue()` succeeds only in `granted` or `granted_admin`, states main entered from a **server response it received itself** (S8). A renderer that calls `continue()` early gets `GATE_LOCKED`.
- `released_offline` re-locks as soon as the API answers again and no clearance exists. The offline grant is recorded in the main log, and in Phase 9/10 can be reported (D5-12).
- **Sign out** is available on the challenge and restricted screens (shared workstations). It returns to Login with the window still locked.
- Re-lock never interrupts an active lockdown. It is queued until lockdown exits.

### 6.7 Reconcile and repair (reuse Phase 4)
- Add marker reason `gate`. `reconcileUser` gains `repairGate(userId)`:
  - For the latest restricted, unrestored run: ensure `User.gateRestriction`, ensure the escalation (`recordCriticalEvent` is idempotent), set `run.escalationId`.
  - For a user flag whose run is restored or missing: clear the flag.
  - Then recompute risk and XP.
- The sweeper also scans `gateruns {status:'restricted', restoredAt:null, escalationId:null}`, bounded at 200 per sweep, for crashes that left no marker.

### 6.8 Unavailable content and offline
- **Fewer active questions than `maxAttempts`** gives 503 `GATE_UNAVAILABLE`, plus one `gate.content_unavailable` warning audit entry per hour (deduped by an idempotency key on the hour) and an error log line. The desktop treats it like offline (D5-12).
- **Desktop offline** (network errors, 5xx, `GATE_UNAVAILABLE`):
  - "Can't reach CSense. Retrying…" with a Retry button.
  - Under `open_after_grace` (default), "Continue offline" appears after `gateOfflineGraceSeconds` (120).
  - Under `closed`, it never appears.
- **Not offline:** a 401 goes to Login, and 403 `ACCESS_RESTRICTED` goes to restricted.

### 6.9 Behavioural risk v2 and gate XP (R9, R10; ADR 0017)
**Gate signal group** (pure, `shared/src/risk/gate.ts`). Facts are the last `GATE_RISK_WINDOW` = 20 **closed** runs by `closedAt`, each `{ status: 'passed'|'restricted', firstAnswerCorrect, closedAt }`.
- n = runs, w = runs whose first answer was wrong, r = restricted runs.
- `gateScore = n === 0 ? null : min(100, roundHalfUp(100·w, n) + GATE_RESTRICTION_POINTS·min(r, GATE_RESTRICTION_CAP))`, with POINTS = 35 and CAP = 2.
- **Behavioural v2:**
  - `v1 = behaviouralScore(attempts, cooldowns)` (unchanged)
  - if both v1 and gate are non-null: `roundHalfUp(70·gate + 30·v1, 100)` (`BEHAVIOURAL_GROUP_WEIGHTS`)
  - if only one is non-null: that one
  - else null
- `RISK_MODEL_VERSION = 2`. `RiskFacts.gate` becomes `{ runs: GateRunFact[] } | null`.
- `riskFacts.service` loads the runs. `digestFacts` sorts them by `closedAt`.
- A `RiskTrigger` type `gate_run` is added.
- **Roll-out:** run `gamification:reconcile --all` after deploy (trigger `model_upgrade`; D4-25 applies: resulting level changes are audited and escalated).
- **Reference cases** (unit tests):

  | Case | gate | v1 | Behavioural |
  |---|---|---|---|
  | n=1, first answer right | 0 | none | 0 |
  | 1 restricted of 1 | 100 | none | 100 |
  | 20 runs, 2 wrong first, 1 restricted | 10+35 = 45 | 20 | `roundHalfUp(70·45+30·20, 100)` = 37.5 → **38** |
  | n=0 | null | 40 | 40 (v1 only) |

  The 37.5 case pins the half-up rounding.
- Restriction alone does not escalate through risk. The critical event already escalates. A risk move into High still opens `risk_level_high` as in Phase 4.

**Gate XP (D5-9):**
- `XP_RULES.gateDailyCheck = 10`, source `gate_daily_check`.
- One entry per **organisation-local calendar day** (`ORG_TIMEZONE`, IANA, default `UTC`), key `gate:<YYYY-MM-DD>`.
- Earned only by a **passed run whose first answer was correct**.
- Pure, from `gateanswers` and `gateruns` facts (ADR 0009 principle 1). Monotone. Not farmable: one per day, and restarts or extra runs within the clearance cannot create a second run.
- With the course maximum of 2,970, Defender (3,500) needs 53 days of first-try gate passes, about 2.5 working months of sustained behaviour, which is what D4-1 intended.
- `GateAttemptResultDTO.xpEarned` = 10 or 0 (attributable to the run).

## 7. Kiosk lockdown during quizzes (R4, R12; ADR 0016)

### 7.1 Entering and exiting: coupled to the server session
- The renderer never asks for lockdown in the abstract. It calls `assessment.startSecure({ kind, moduleId? })`, and main runs:
  1. `AppLock.lock('lockdown')` (state `entering`; the renderer shows the pending view).
  2. `POST .../sessions`. On 201, main records the session in `ActiveLockdown { sessionId, kind, moduleId, expiresAt, session DTO }` and goes to `active`.
  3. Main **then** returns the questions to the renderer.
  4. On any error, main unlocks (`failed` then `inactive`) and returns the error. `ASSESSMENT_COOLDOWN` carries `retryAt`.
- **Questions reach the renderer only while lockdown is active** (S16).
- **Validation against an active server session:** main started the session itself and holds the 201 response. It does not trust a renderer-supplied `sessionId`.
  - `submit`, `exit` and `resume` must name **the** active `sessionId`, otherwise `LOCKDOWN_NOT_ACTIVE`.
  - Main exposes no lockdown entry that does not start a session (S17).
- **`assessment.submit`:**
  - Main forwards to `.../attempts`.
  - On 201, or on the terminal 409s (`SESSION_CLOSED`, `SESSION_EXPIRED`), main exits lockdown, then returns the result.
  - On a network error it **stays** in lockdown and lets the renderer retry. The Exit button remains available.
  - On 409 `ASSESSMENT_COOLDOWN` (submission refused during cooldown) it exits and returns the error.
- **`assessment.exit`** (the "Exit quiz" path, the D5 attempt):
  1. Main **first exits lockdown locally**, synchronously, with no network dependency.
  2. Then it calls `.../abandon` in the background (3 retries with backoff).
  3. If abandon never succeeds, a `pendingAbandon` record (in memory and in `userData/pending.json`, ids only) is retried at the next connectivity.
  4. If it is still undelivered, the server session expires or is closed by the next start, as in ADR 0007.
- **Hard cap:** lockdown auto-exits at `expiresAt + 60 s` whatever the renderer does.

### 7.2 What `lock('lockdown')` does (main window, Windows-first)
1. `setKiosk(true)`, `setFullScreen(true)`, `setAlwaysOnTop(true, 'screen-saver')`, `setClosable(false)`, `setMinimizable(false)`, `setMovable(false)`, `setSkipTaskbar(true)`.
2. Cover windows go on other displays.
3. **`setContentProtection(true)`.** On Windows 10 2004+ this is `WDA_EXCLUDEFROMCAPTURE`: screenshots, Snipping Tool, PrintScreen and screen-recording or sharing tools capture black (D5-18).
4. `clipboard.clear()`: all formats, and `'selection'` on Linux (D5-17).
5. `closeDevTools()`. `devtools-opened` → close, plus a violation event.
6. The input filter (7.3) is installed.
7. `globalShortcut.register('PrintScreen', noop)`, best effort. It is released on exit and by the OS on process death.
8. Main logs `lockdown.entered` (session id only).

`unlock()` reverses every step, clears the clipboard again, unregisters the global shortcut and restores the window bounds. It is **idempotent**, and every exit path calls it.

### 7.3 Input filter (`before-input-event`, allowlist)
Active in the `gate` and `lockdown` profiles. The default is **block**. Allowed:

| Key | Why |
|---|---|
| Tab, Shift+Tab | keyboard navigation (no trap) |
| Enter, Space | activate |
| Arrow keys, Home, End, PageUp, PageDown | radio groups, scrolling |
| Escape | delivered to the renderer only to close the "Leave the quiz?" dialog; never exits lockdown (amends screens.md "Esc is blocked", D5-19) |
| Printable characters without Ctrl, Alt or Meta | Login fields; the quiz has no text input |
| Ctrl+Plus, Ctrl+Minus, Ctrl+0 | zoom (WCAG 1.4.4 resize text) |
| Ctrl+A, Ctrl+Z, Backspace, Delete | **gate profile only, inside the Login inputs** (editing) |

Blocked, and covered by an explicit test-table row each:
- Ctrl/Cmd+C, V, X; Ctrl+Insert, Shift+Insert, Shift+Delete
- Ctrl+R, F5, Ctrl+Shift+R
- F12, Ctrl+Shift+I, J, C
- Ctrl+P, S, O, N, T, W, F, G, U
- F11, Alt+F4, Alt+Space, Alt+Left, Alt+Right, Alt+Home
- F1 to F10 (F7 caret browsing)
- the ContextMenu key

Mouse:
- The `context-menu` event is ignored (no menu is built).
- Middle-click and auxclick on links are prevented in the renderer.
- `navigateOnDragDrop: false` stops drag-and-drop navigation.

Copy and paste are blocked in two layers: the main filter, and the renderer `copy`, `cut`, `paste` and `contextmenu` listeners in `LockdownShell`. Main is the enforcement point.

### 7.4 Focus loss (D5-15)
- On `blur` while lockdown is active:
  - main calls `moveTop()`, `focus()` and `flashFrame(true)`
  - it emits `lockdown-violation {kind: 'focus_lost', count, remaining}`
  - the `LockdownBanner` shows the warning "You left secure mode. Leaving N more time(s) ends this attempt." (`role=alert`, polite)
- **Auto-abandon** happens when either:
  - focus losses reach `lockdownMaxFocusLosses` (3)
  - focus is away continuously for more than `lockdownFocusAwaySeconds` (15)

  Auto-abandon runs the `assessment.exit` path. The attempt counts and is `abandoned` server-side, so it already feeds Behavioural conduct (abandon rate). The renderer shows "This attempt ended because CSense lost focus."
- Blurs shorter than 500 ms are ignored (OS notifications, IME popups).
- UAC and secure-desktop prompts **will** cause blurs. Three in one quiz are unlikely, and that is accepted (risk 7).

### 7.5 Crash and hang recovery (no trap, ever)
- **Renderer crash** (`render-process-gone`) while active:
  - First crash in this session: the window **stays locked**, main reloads the renderer, and the renderer calls `assessment.resume()`. It gets the cached session DTO (questions, no keys); answers given so far are lost. The banner says "CSense restarted the quiz screen."
  - Second crash in the same session: `assessment.exit` path, then reload.
- **Hang** (`unresponsive`) for more than 10 s: `forcefullyCrashRenderer()`, then the crash path.
- **Main-process crash or kill:** every restriction is a property of the main process's window, kiosk state or global shortcut, so the OS removes them all. Nothing persists that could trap the user (S20). The server session is closed by the next start or expires.
- **Lockdown never blocks OS logoff or shutdown.**
- **WCAG 2.1.2:** the "Exit quiz" control is always rendered in the banner and reachable with Tab. Its confirm dialog focuses "Keep going", and Escape closes the dialog. An e2e test completes the exit with the keyboard only.

### 7.6 Honest limits (what Electron cannot block from user space on Windows)
These cannot be blocked; they are documented in ADR 0016 and listed for Phase 9 manual testing:
- Ctrl+Alt+Del (secure attention sequence), and anything reachable from it (Task Manager, sign out, lock).
- Ctrl+Shift+Esc (opens Task Manager), and killing the process.
- Win key combinations:
  - Win, Win+D, Win+Tab, Win+L, Win+R
  - Win+Shift+S (the capture is black because of content protection, but the tool opens)
  - Win+V (clipboard history: it can show earlier entries; clearing cannot remove history items that were pinned or synced, risk 8)
- **Alt+Tab:** Windows reserves it, and `globalShortcut` cannot register it. The switcher opens and another window may get focus. The always-on-top full-screen window remains visible above normal windows, and the blur policy (7.4) handles the rest.
- A second physical or virtual machine, a phone camera, another person, screen readers or OCR on another device.
- Remote-desktop and VM tools that capture at the hypervisor level (content protection does not apply).
- An administrator user who changes policies or attaches a debugger.
- Accessibility tools (Narrator, Magnifier, the on-screen keyboard) are intentionally **not** blocked.

Phase 10 (managed fleet) narrows this list: Assigned Access, `NoWinKeys`, `DisableTaskMgr`, clipboard-history policy (`AllowClipboardHistory=0`), AppLocker.

### 7.7 Interactions
- **Clearance expiry or sign-out during lockdown:** the gate re-lock is queued until lockdown exits. A sign-out requested in the tray is not available while locked.
- **Session refresh failure during lockdown** (revoked): the submit fails with `SESSION_EXPIRED` → `assessment.exit` path (local unlock; abandon cannot be sent), then Login.
- **Notifications** are suppressed during lockdown and while the gate is locked.

## 8. Native OS notifications for training reminders (R5; D5-21)
- **Triggers.** Computed in main from existing APIs; **no new server route** in Phase 5. They come from `GET /modules` (`LearningOverviewDTO`) after release:
  1. **Continue training:** an unlocked, incomplete module exists, and no learning call was made through the app in the last 2 hours. Text: "Training reminder: continue Module N."
  2. **Quiz available again:** a quiz or the final test had `cooldownUntil` in the future when last seen. Main schedules a one-shot reminder at `cooldownUntil`: "You can retry the quiz now."
  3. **Final assessment unlocked:** the final test changed from locked to unlocked. Shown once.
- **Scheduling:**
  - The first check runs `reminderFirstDelay` (120 min) after release, then every `reminderInterval` (240 min) while the app runs (tray).
  - At most `reminderMaxPerDay` (2) per day.
  - Never during gate or lockdown.
  - Never while the CSense window is focused (an in-app banner is used instead).
  - The state (`lastShownAt` per kind, a count per day) goes to `userData/reminders.json`: no PII, no titles.
  - Phase 7 due dates and campaign reminders replace or extend this through a server feed (`/me/reminders`, contract later).
- **Content.** Generic and non-sensitive: no scores, no risk, no question text. Toasts can appear on the lock screen.
- **Click:** show and focus the main window and send `navigate` with `home` (Phase 6 adds `{module}` deep links). Ignored while locked.
- **Permissions and platform:**
  - `app.setAppUserModelId('com.csense.desktop')` at start-up, so Windows toasts work and are grouped.
  - Packaged installs need a Start-menu shortcut carrying the AUMID (Phase 10 installer). In unpackaged development, toasts may not appear; this is logged, not an error.
  - `Notification.isSupported()` is checked.
  - Focus Assist or Do Not Disturb can suppress toasts silently. The in-app banner on the next open is the fallback.
  - The renderer's Web Notification permission stays denied.

## 9. Renderer wiring: the Phase 5 minimum (R1, R3, R4, G)
Phase 6 owns the polished journey. Phase 5 wires only what the gate and the e2e need:
1. **`App.tsx` becomes a small state router** driven by `events.subscribe` and `session.getState` / `gate.getView`.
   - `Boot` is a spinner on `GateShell`.
   - `Login` → `SecurityGate` → `TrainingHome` (new, minimal) → `Quiz`.
   - Config error and offline states are rendered inside `GateShell` (new presentational states, built from design-system components only).
   - No `fetch` anywhere in the renderer; an ESLint `no-restricted-globals` rule on `fetch`, `XMLHttpRequest` and `WebSocket` for `src/renderer/**` enforces this.
2. **`LoginScreen`:**
   - `onSubmitCredentials` → `session.login`.
   - Error mapping: `INVALID_CREDENTIALS` → "Email or password is incorrect."; `RATE_LIMITED` → "Too many attempts. Try again in N minutes."; `NETWORK_UNAVAILABLE` → "Can't reach CSense."
   - The password field is cleared after every attempt.
3. **`SecurityGateScreen`:**
   - `state` comes from `GateView` (`challenge`, `granted`, `restricted`).
   - Options map to `{ id: String(index), text }`.
   - `onSubmitGateAnswer(id)` → `gate.submitAnswer({ challengeId, optionIndex: Number(id) })`.
   - `feedback` comes from the result.
   - `attemptsRemaining` and `maxAttempts` come from the status.
   - `onContinue` → `gate.continue()`, with `autoContinueMs = 2000` only when granted by an existing clearance.
   - `restricted.referenceId` comes from the server. `contactText` comes from `RENDERER_VITE_SECURITY_CONTACT_TEXT` (build-time, optional, client branding pending).
   - Sign-out link (new prop `onSignOut`).
4. **`TrainingHome` (new, minimal, temporary):**
   - A heading, the employee name and level.
   - A list from `learning.getOverview()` showing each module's derived status.
   - A "Start quiz" button for each module whose `getQuizOverview` reports it available.
   - No module player: content completion happens in Phase 6, and the e2e seed pre-completes module 1's content.
   - It is replaced by `EmployeeDashboard` in Phase 6.
5. **`QuizScreen` and `LockdownShell`:**
   - `onRequestStartLockdown` → `assessment.startSecure`.
   - `lockdownState` comes from `lockdown` events.
   - Questions are mapped from `AssessmentSessionDTO` (option ids are index strings).
   - `onSubmit` → `assessment.submit` (`selectedIndex` null for unanswered).
   - `onConfirmExit` → `assessment.exit`.
   - The `result` mapping uses `AttemptResultDTO` (`effects.xpEarned`, `badge`).
   - `review` uses `GET /me/attempts/:id` in Phase 6. Phase 5 shows the result only, and "Review answers" is hidden (prop already optional).
   - `lockdown-violation` → a banner message.
6. **`screens.md` updates:** the Esc note (D5-19), the Sign-out link on the gate, the offline and misconfigured states, and the focus-loss warning copy.

## 10. Security properties the security-tester will try to break
**Shell and bridge**
1. S1. The renderer has no Node.js: `require`, `process` and `module` are undefined. Bridge keys are exactly the v1 set, and `ipcRenderer` is not reachable.
2. S2. No development relaxation (http API, `CSENSE_*` overrides, devtools) is active when `app.isPackaged` is true, whatever the environment or command line. Debugging switches abort a packaged start.
3. S3. Navigation, new windows, redirects, webviews, drag-and-drop navigation and `file://` loads are all denied. Only the app origin renders.
4. S4. The renderer cannot open a network connection (CSP plus the session egress filter). Only main reaches the API, through a separate in-memory session.
5. S5. Every IPC channel is declared and zod-validated, and rejects extra fields, oversize input and non-ObjectId ids. There is no generic passthrough, and the channel inventory is snapshot-tested.
6. S6. IPC from any frame other than the main window's top frame on the app origin is refused.

**Tokens and session**
7. S7. The refresh token is never written unencrypted. If safeStorage is unavailable or Linux `basic_text`, nothing is persisted.
8. S8. No token ever crosses IPC or appears in `localStorage`, `sessionStorage`, IndexedDB, cookies, logs or crash dumps written by CSense.
9. S9. Concurrent 401s cause exactly one refresh; no reuse-detection self-revocation under load. Logout wipes local state even when the network fails.

**Gate**
10. S10. A restricted employee gets 403 `ACCESS_RESTRICTED` on every employee route except the four allowlisted. The restriction survives logout, a new login, reinstall and another workstation.
11. S11. The client cannot claim a pass: there are no `correct`, `passed` or `score` fields (400), and grading uses only the server-held key snapshot.
12. S12. Attempts cannot be reset: not by restart, new session, new challenge request, sign-out or another workstation. Only a pass or an admin restore opens a fresh run.
13. S13. Challenges are single-use: a replayed or stale `challengeId` gives 409, and concurrent submits consume exactly one attempt. Another user's `challengeId` gives 409 and leaks nothing.
14. S14. Failed logins never change gate state, so there is no lever to restrict or escalate a colleague.
15. S15. No gate response reveals a correct option. The question does not repeat within a run, and re-requesting a challenge returns the same question (no question shopping).
16. S16. The main process releases the workstation only after it has itself received `granted` from the server. A renderer calling `gate.continue()` early is refused.

**Lockdown**
17. S17. Quiz questions reach the renderer only while lockdown is active, and lockdown cannot be entered without a server session that main started.
18. S18. During lockdown: copy, cut and paste fail and the clipboard is empty on entry and exit; devtools cannot open; reload, close, Alt+F4, F11 and navigation fail; screen capture of the window is black.
19. S19. Focus loss is detected, warned and, past the policy, abandons the attempt (counted server-side).
20. S20. Lockdown is always exitable: the Exit button by keyboard, renderer crash, hang, main crash and the hard cap all leave the OS unrestricted. No keyboard trap.
21. S21. Restore-access is administrator-only, needs an acknowledged escalation and a note, and is audited (note hash only). Restoring does not resolve the escalation.
22. S22. Every restriction produces exactly one critical escalation and its audit entries (`governance.critical_event_recorded`, `escalation.opened`), even after partial failures (reconcile).
23. S23. The API base URL is https in packaged builds. A non-https or credential-bearing URL is refused before any request. TLS errors are never overridden.
24. S24. Notification content carries no sensitive data, and clicks cannot navigate outside the renderer's allowlisted targets.

## 11. Escapes: what the e2e must prove fail, and what cannot be blocked
**E2E must prove these fail** (Playwright, synthetic input through CDP and `webContents.sendInputEvent`):
- Gate:
  - `window.close()` from the page
  - Alt+F4
  - Ctrl+W
  - `gate.continue()` before granted
  - navigation to an external URL (`location.href`, `window.open`)
  - F12 and Ctrl+Shift+I (devtools stays closed)
  - Ctrl+R (a page marker survives)
- Lockdown, all of the gate list plus:
  - Ctrl+C on selected question text (the clipboard stays empty)
  - Ctrl+V of text placed on the clipboard before entry (it was cleared)
  - Escape (lockdown stays active)
  - F11
  - `BrowserWindow.blur()` three times (auto-abandon happens, a warning first)
  - a renderer crash (`forcefullyCrashRenderer`): one resume, then a forced exit
  - the content-protection flag being on (`isContentProtected()` where available, otherwise the controller's state through `app.evaluate` on the window)
- The Exit quiz path by keyboard only.

**Cannot be blocked from user space** (manual Phase 9 checklist; ADR 0016): the list in section 7.6, plus process kill for the gate (section 2).

**Test-tool caveat (risk 4).** It is assumed that CDP-dispatched key events pass through `before-input-event`. If an Electron version proves otherwise:
- e2e uses `webContents.sendInputEvent` (the same browser-side path)
- the filter's decision table stays fully unit-tested
- real-keyboard behaviour joins the manual checklist

## 12. Tests

### 12.1 Shared (Vitest, pure)
- **GQ1** `gateQuestionAuthoringSchema`: option count 3..6, index range, non-empty explanation, explanation must not contain the correct option's text.
- **GS1–GS4** gate DTO and request schemas are strict (extra fields, `correct`, `passed` → fail); no key fields.
- **GR1–GR6** `gateScore`:
  - n=0 → null
  - single runs
  - the window keeps the last 20 by `closedAt`
  - the restriction cap of 2
  - the 100 cap
  - half-up rounding
- **BV1–BV5** Behavioural v2: the blend (70/30) with the reference table in 6.9 (including 37.5 → 38); either side alone; both null; `RISK_MODEL_VERSION === 2`; the weights constant is asserted.
- **XPG1–XPG5** gate XP:
  - only first-answer-correct passes
  - one per org-local day (`Africa/Casablanca` and `America/New_York` boundary cases)
  - idempotent
  - monotone
  - 0 for restricted runs
- **SEL1** `selectQuestionIds(..., 1, ...)` for gate history: no repeat within a run, least recently served first.

### 12.2 Server integration (supertest plus mongodb-memory-server; new files under `server/test/`)
- **`gate.flow.test.ts`:**
  - GT1 status `required` → challenge (3 of 3); a repeated challenge gives the same `challengeId`.
  - GT2 correct answer → 201 `granted`, `clearedUntil = now + TTL` (injected clock), explanation, `xpEarned: 10`; the second pass the same day gives 0.
  - GT3 wrong answer → `correct:false`, explanation, 2 remaining, a new `challengeId` and a different question.
  - GT4 clearance expiry → `required`.
  - GT5 an administrator gets 403 on `/gate/*`.
- **`gate.restricted.test.ts`:**
  - GT6 three wrong answers → restricted, with `referenceId` format.
  - GT6 also: escalation `gate_access_restricted`, `critical`, tier per D5-6, `sourceRef {gate_event, runId}`; audit entries `governance.critical_event_recorded` plus `escalation.opened` (chain verifies); `User.gateRestriction` set.
  - GT7 every employee route outside the allowlist → 403 `ACCESS_RESTRICTED` (sweep over the registry); `/auth/me`, `/gate/status`, `/gate/challenge`, `/config/features` → 200.
  - GT8 logout plus a new login keeps the restriction.
- **`gate.tamper.test.ts`:**
  - GT9 body with `correct`, `passed` or extra fields → 400.
  - GT10 out-of-range index → 400 and no attempt consumed.
  - GT11 replayed or stale `challengeId` → 409.
  - GT12 ten concurrent submits → exactly one recorded, the rest 409.
  - GT13 user B submits user A's `challengeId` → 409, and A's run is unchanged.
  - GT14 after 2 wrong answers, a new session or restart still shows 1 remaining.
  - GT15 failed logins (×20) leave gate state unchanged.
  - GT16 deep scan: no `correctAnswer` or `explanation`-before-answer anywhere.
- **`gate.restore.test.ts`:**
  - GT17 restore with the escalation `open` → 409 `ESCALATION_NOT_ACKNOWLEDGED`.
  - GT18 acknowledge, then restore → 200; `gate.access_restored` warning with `noteSha256` and no note text; escalation `note` event audited; flag cleared; the next challenge gets 3 attempts; the escalation is not resolved.
  - GT19 not restricted → 409 `NOT_RESTRICTED`; unknown or admin target → 404; employee token → 403; bad note (control chars, over 2000) → 400.
- **`gate.resilience.test.ts`:**
  - GT20 escalation service throws on restrict → 201 still restricted, a marker written; reconcile opens exactly one escalation.
  - GT21 the user-flag write fails → reconcile sets it.
  - GT22 a stale flag whose run was restored → reconcile clears it.
  - GT23 pool below `maxAttempts` → 503 `GATE_UNAVAILABLE`, one audit warning per hour.
- **`risk.v2.test.ts`:**
  - RV1 the restriction recompute writes a `riskassessments` entry with trigger `critical_event` and Behavioural from gate facts.
  - RV2 `gamification:reconcile --all` upgrades v1 profiles to v2 (trigger `model_upgrade`).
  - RV3 the digest is stable under fact reordering.
- **Updates to existing suites:**
  - `rbac.denyByDefault` B1 inventory: +4 routes, `allowWhileRestricted` in the snapshot.
  - B2 and B3 sweeps.
  - `routeRegistry.test` (`allowWhileRestricted` only on employee or authenticated routes).
  - `models.indexes` (gate unique indexes).
  - `env.test` (new keys and bounds).
  - Phase 4 `risk.profile` fixtures move to v2. v1 expectations stay valid where gate is null.

### 12.3 Desktop main unit tests (Vitest, node environment)
A new Vitest project `desktop-main` (`desktop/vitest.main.config.mts`, included in the root `projects`). Electron is faked through injected ports: `ElectronPorts { safeStorage, clipboard, globalShortcut, fs, windowFactory, notification, powerMonitor, fetch }`. Main modules never import `electron` directly except in `main/electron/ports.ts`.
- **IPC1–IPC8 `ipcRegistry`:**
  - unknown channel
  - missing schema → start-up throws
  - preload/registry list mismatch → throws
  - strict schemas (extra fields, oversize string, bad ObjectId, 72-byte password bound, over 64 KB payload)
  - sender from a subframe or foreign origin → `FORBIDDEN_SENDER`
  - the per-channel rate guard
  - handler throw → `{ ok:false, code:'INTERNAL' }` with no stack
  - the channel inventory snapshot
- **CFG1–CFG8 `config`:** the URL policy matrix (packaged/unpackaged × https/http × loopback/LAN/public × credentials/query/fragment/wrong path); every `CSENSE_*` is ignored when packaged; numeric bounds.
- **TS1–TS9 `tokenStore`:**
  - encrypt, persist and load round trip
  - unavailable encryption → memory-only and **no file write** (fs spy)
  - `basic_text` → memory-only
  - a corrupt file is deleted
  - an expired file is deleted
  - atomic write (temp plus rename)
  - logout wipes even when the network fails
  - the persisted file never contains the token in clear (byte scan)
  - nothing in any `SessionView` contains a token
- **AC1–AC9 `apiClient`:**
  - bearer attached
  - 10 concurrent 401s → exactly one refresh, all retried once
  - refresh with `INVALID_REFRESH_TOKEN` → signed_out event and wipe
  - no retry on 403/409
  - proactive refresh under 60 s
  - the lockdown proactive timer
  - persist-before-resolve ordering
  - response schema mismatch → `BAD_RESPONSE`
  - path params encoded and validated
  - timeout → `NETWORK_UNAVAILABLE`
- **GC1–GC10 `gateController`:**
  - starts locked before any request
  - `continue()` refused unless granted
  - release only from a server response
  - re-lock at `clearedUntil`
  - re-lock on `unlock-screen` with expired clearance
  - offline grace under both policies
  - re-lock on reconnect from `released_offline`
  - restricted poll → release after restore
  - admin path
  - quit refused while locked except `session-end`
  - re-lock deferred during lockdown
- **LC1–LC14 `lockdownController`:**
  - enter only through `startSecure`; questions only after active
  - error on start → unlocked
  - submit/exit with a foreign `sessionId` → `LOCKDOWN_NOT_ACTIVE`
  - exit unlocks before the network call; abandon is retried and `pendingAbandon` persisted (ids only)
  - the clipboard is cleared on enter and on exit
  - content protection on and off
  - global shortcut registered and unregistered
  - `devtools-opened` → closed plus a violation
  - focus loss: warning, then auto-abandon at 3; 15 s away → abandon; under 500 ms ignored (fake timers)
  - renderer crash → reload plus resume; second crash → exit
  - unresponsive 10 s → crash path
  - the hard cap at `expiresAt + 60 s`
  - `unlock()` is idempotent
- **IF1 input filter decision table:** every allowed and blocked key or combination in 7.3, per profile (a table-driven test; this is the canonical list).
- **NT1–NT6 `reminderScheduler`:** the three triggers; the per-day cap; suppressed during gate, lockdown and focus; the click focuses the window and emits `navigate: home`; unsupported platform → no-op; persisted state carries no titles.
- **LOG1** redaction of every sensitive key.

Renderer unit tests (existing jsdom project):
- the `App` state router transitions
- the Login error mapping
- the SecurityGate wiring (index ↔ id mapping)
- the Quiz mapping from `AssessmentSessionDTO` and `AttemptResultDTO`
- `TrainingHome` states
- axe on the new offline, misconfigured and focus-warning states

### 12.4 E2E harness (ADR 0018)
- **`server/src/testing/e2eServer.ts`**, compiled to `server/dist/src/testing/e2eServer.js`:
  - It refuses to run unless `NODE_ENV === 'test'` and `CSENSE_E2E_HARNESS === '1'`.
  - It dynamically imports `mongodb-memory-server` (a dev dependency, present in CI and dev only).
  - It connects, ensures indexes and seeds the learning, badge and gate content.
  - It creates an admin (bootstrap path), a second admin (separation of duties), and employees `gate-pass@`, `gate-fail@` and `quiz@`. The `quiz@` employee has module 1's content completed: `UserProgress` written directly, all exercises recorded.
  - It starts `createApp` on `127.0.0.1:0` with test secrets generated per run.
  - It prints one JSON line `{ baseUrl, accounts, gateKey: { [prompt]: correctIndex } }` to stdout. `gateKey` exists only in this test-only process output. It stops on SIGTERM or stdin close.
- **Playwright `globalSetup`** (`desktop/e2e/support/globalSetup.ts`):
  - spawns `node server/dist/src/testing/e2eServer.js`
  - waits for the ready line (90 s timeout, which covers the first MongoDB binary download on Windows)
  - writes `desktop/e2e/.run/backend.json` (gitignored)
  - `globalTeardown` kills the process
- **Each spec** launches Electron with:
  - `CSENSE_API_BASE_URL=<baseUrl>`
  - `CSENSE_USER_DATA_DIR=<fresh temp dir>`
  - `CSENSE_GATE_POLL_SECONDS=2`
  - `CSENSE_DEVTOOLS=0`
  - the gate key lookup by prompt text read from the UI
- **CI** (`.github/workflows/ci.yml`, e2e job):
  - add `MONGOMS_DOWNLOAD_DIR` plus a cache for `~/.cache/mongodb-binaries` on Windows
  - add `NODE_ENV: test` to the e2e step env
  - timeout 30 min
  - `npm run build` (already) builds the server dist the harness needs
  - the a11y step is unchanged

### 12.5 Playwright Electron e2e (windows-latest)
- **`smoke.spec.ts` (updated):**
  - one window
  - no Node in the renderer
  - bridge keys exactly `['bridgeVersion','appVersion','session','gate','assessment','learning','events']`, each nested function list exact
  - webPreferences hardened (plus `webviewTag:false`)
  - loaded from `app://csense`
  - CSP header present
- **`gate.spec.ts`** (the playbook gate, part 1: "gate blocks, then grants"):
  1. At launch the window is `isKiosk`, `isAlwaysOnTop`, full screen, not closable; Login is shown.
  2. Escapes fail: `window.close()`, Alt+F4, Ctrl+W, `window.open`, `location.href = 'https://example.com'`, F12, Ctrl+Shift+I.
  3. `window.csense.gate.continue()` → `GATE_LOCKED`, still locked.
  4. Sign in as `gate-pass@`; a wrong login first shows the generic error.
  5. The challenge renders with "3 of 3".
  6. A wrong answer shows "Not quite", 2 remaining, and a different prompt.
  7. The correct answer shows "Access granted".
  8. Continue → the window is unlocked (`isKiosk` false, closable) and `TrainingHome` is visible.
  9. Relaunch with the same userData: the session resumes, "Access granted" auto-continues (clearance), and no new question is asked.
- **`gate.restricted.spec.ts`** (part 2: "retry exhaustion → restricted"):
  1. `gate-fail@` answers wrong three times → "Access restricted" with a `GATE-` reference; the window stays locked; quit is refused.
  2. A relaunch is still restricted, with no new attempts.
  3. Via HTTP from the test: admin A acknowledges the escalation (found by `reason=gate_access_restricted&userId`), the restore call succeeds, and the app polls and shows a fresh challenge with 3 attempts.
- **`lockdown.spec.ts`** (part 3: "lockdown active, obvious escapes fail"):
  1. `quiz@` passes the gate, then Start secure quiz → lockdown `active`: kiosk, always on top, content protected; questions visible.
  2. Text is put on the clipboard before start → it is empty after entry.
  3. Each escape in section 11 fails. The devtools state, the clipboard (`app.evaluate(({clipboard}) => clipboard.readText())`) and a page marker are asserted after each.
  4. Blur once → the warning banner. Blur twice more → the attempt is ended as abandoned, the result is shown, and the window is unlocked.
  5. A new session (the reuse window has passed): crash the renderer → the resume banner, still locked; crash again → unlocked with the abandoned result.
  6. A new session: keyboard only (Tab to "Exit quiz", Enter, Tab to "Leave quiz", Enter) → unlocked; the clipboard works again.
  7. A new session: answer and submit → the result is shown and lockdown exits.

  Cooldown settings in the harness (`ASSESSMENT_COOLDOWN_AFTER_FAILS=10`, `SESSION_START_RATE_MAX=50`) keep the spec deterministic.
- **`security.spec.ts`:**
  - after login, scan `localStorage`, `sessionStorage`, `document.cookie` and `indexedDB.databases()` for JWT-shaped or refresh-shaped strings → none
  - call every bridge read method and scan the results for `accessToken` or `refreshToken` → none
  - a renderer `fetch(baseUrl)` → blocked
  - launching with `CSENSE_API_BASE_URL=http://example.com/api/v1` → the misconfigured screen and zero requests (the harness counts requests)

## 13. Environment and configuration additions
**Server (`server/src/config/env.ts`, `appConfig.ts`, `.env.example`):**

| Key | Default | Bounds |
|---|---|---|
| `GATE_MAX_ATTEMPTS` | 3 | 1..10 |
| `GATE_CLEARANCE_TTL` | 12h | 5m..24h |
| `GATE_RESTORE_REQUIRES_ACK` | true | boolean (D5-7) |
| `ORG_TIMEZONE` | UTC | valid IANA zone (`Intl.DateTimeFormat` check at start-up) |
| `CSENSE_E2E_HARNESS` | unset | read only by `testing/e2eServer.ts`; never by `createApp` |

**Desktop** (build-time `MAIN_VITE_*` / `RENDERER_VITE_*` in `.env.example`, desktop section; runtime `CSENSE_*` documented as unpackaged-only):
- `MAIN_VITE_API_BASE_URL`: the comment changes to "https required in packaged builds; http only to localhost in development".
- `MAIN_VITE_GATE_OFFLINE_POLICY=open_after_grace`
- `MAIN_VITE_GATE_OFFLINE_GRACE_SECONDS=120`
- `MAIN_VITE_LOCKDOWN_MAX_FOCUS_LOSSES=3`
- `MAIN_VITE_LOCKDOWN_FOCUS_AWAY_SECONDS=15`
- `MAIN_VITE_AUTOSTART=true`
- `MAIN_VITE_REMINDER_FIRST_DELAY_MINUTES=120`
- `MAIN_VITE_REMINDER_INTERVAL_MINUTES=240`
- `MAIN_VITE_REMINDER_MAX_PER_DAY=2`
- `RENDERER_VITE_SECURITY_CONTACT_TEXT=` (optional; client identity pending)
- Unpackaged-only: `CSENSE_API_BASE_URL`, `CSENSE_USER_DATA_DIR`, `CSENSE_GATE_POLL_SECONDS`, `CSENSE_DEVTOOLS`

**Sizing note for D-10, in `.env.example` next to `RATE_LIMIT_MAX`:** a desktop start-up makes about 6 to 8 requests (refresh, me, gate status, challenge, 1 to 3 answers, the overview). Idle traffic is under 2 requests per hour per workstation. With every employee behind one egress IP, the default `RATE_LIMIT_MAX=1000` per 15 min supports roughly 120 to 150 simultaneous morning start-ups. Raise it, or confirm the proxy topology (`TRUST_PROXY_HOPS`), before roll-out.

**Dependencies:**
- Desktop gains `zod` as a direct dependency. It is already in the tree through `@csense/shared`; the same version is pinned.
- No other new runtime dependency.
- `mongodb-memory-server` stays a server dev dependency.

## 14. Files to create or change

### 14.1 Shared (`shared/src/`)
- **New:**
  - `constants/gate.ts`: `GATE_ATTEMPTS_*` bounds, `GATE_OPTION_MIN/MAX`, `GATE_RISK_WINDOW`, `GATE_RESTRICTION_POINTS`, `GATE_RESTRICTION_CAP`, `GATE_STATES`
  - `schemas/gate.ts`: requests and authoring
  - `schemas/gateResponses.ts`
  - `risk/gate.ts`
  - `gate/reference.ts`: `formatGateReference(runId, closedAt, tz)`
  - tests: `risk/risk.gate.test.ts`, `schemas/gate.schemas.test.ts`, `gamification/xp.gate.test.ts`
- **Change:**
  - `constants/risk.ts` (`RISK_MODEL_VERSION = 2`)
  - `risk/behavioural.ts` (v2 blend), `risk/profile.ts` (`RiskFacts.gate`)
  - `constants/gamification.ts` (`gateDailyCheck`, source), `gamification/xp.ts` (gate facts)
  - `constants/audit.ts` (+ `gate.access_restored`, `gate.content_unavailable`)
  - `constants/errors.ts` (+ `ACCESS_RESTRICTED` 403, `GATE_CHALLENGE_STALE` 409, `GATE_UNAVAILABLE` 503, `NOT_RESTRICTED` 409, `ESCALATION_NOT_ACKNOWLEDGED` 409)
  - `constants/governance.ts` (`CRITICAL_EVENT_POLICY` per reason, D5-6)
  - `types/auth.ts` (`AuthContext.accessRestricted`)
  - `index.ts` exports

### 14.2 Server (`server/src/`)
- **New:**
  - `models/GateQuestion.ts`, `models/GateRun.ts`, `models/GateAnswer.ts`
  - `features/gate/gate.routes.ts`, `gate.service.ts`, `gate.mapper.ts`, `restore.service.ts`, `gateFacts.ts` (risk and XP facts)
  - `scripts/seed/gateContent.ts` (30 questions), `scripts/seedGate.ts` (`seed:gate:dev`; the same guards as `seedLearning`)
  - `testing/e2eServer.ts`
- **Change:**
  - `models/User.ts` (Employee `gateRestriction`), `models/index.ts`
  - `db/learningIndexes.ts` (gate unique indexes verified)
  - `http/routeRegistry.ts` (`allowWhileRestricted`), `http/accessGate.ts`
  - `features/auth/auth.service.ts` (select and context)
  - `features/governance/escalation.service.ts` (`recordCriticalEvent` reads the tier and severity from `CRITICAL_EVENT_POLICY`)
  - `features/risk/riskFacts.service.ts`, `risk.service.ts` (trigger `gate_run`)
  - `features/gamification/xpFacts.service.ts`
  - `features/maintenance/reconcile.service.ts`, `markers.ts` (reason `gate`), `sweeper.ts`
  - `config/env.ts`, `config/appConfig.ts`
  - `routes.ts`
  - `package.json` (`seed:gate:dev`)
- **Tests:** section 12.2, plus updated B1 inventory and fixtures (`test/helpers/gateFixtures.ts`).

### 14.3 Desktop (`desktop/`)
**New:**
- `src/shared/ipc.ts`: channel list, input schemas, the `Result` type, `MainEvent`; imported by main and preload
- `src/main/`:
  - `bootstrap.ts`: app lifecycle, single instance, auto-start, AUMID, protocol, command-line guard
  - `config.ts`, `log.ts`
  - `electron/ports.ts`
  - `security/hardening.ts`: webPreferences, navigation, permissions, egress filter, certificate errors
  - `security/protocol.ts`: `app://` handler and CSP header
  - `ipc/registry.ts`, `ipc/handlers/{session,gate,assessment,learning}.ts`
  - `session/tokenStore.ts`, `session/sessionService.ts`
  - `api/client.ts`, `api/operations.ts`
  - `lock/appLock.ts`, `lock/inputFilter.ts`, `lock/covers.ts`
  - `gate/gateController.ts`
  - `lockdown/lockdownController.ts`
  - `notifications/reminderScheduler.ts`
  - `tray.ts`
- `src/main/**/*.test.ts` (section 12.3), `vitest.main.config.mts`
- `src/cover/cover.html`: static, no script
- `build/fuses.config.ts`: values only; applied in Phase 10
- `src/renderer/src/app/` `AppRouter.tsx`, `useMainEvents.ts`, `bridge.ts` (typed accessor with a `bridgeVersion` check)
- `screens/TrainingHome/*`
- the `GateShell` states `Offline` and `Misconfigured` (components only)
- `e2e/support/{globalSetup,globalTeardown,backend,launch,keys}.ts`
- `e2e/{gate,gate.restricted,lockdown,security}.spec.ts`

**Change:**
- `src/main/index.ts` (becomes a thin entry calling `bootstrap`)
- `src/preload/index.ts`, `src/preload/bridge.d.ts`
- `src/renderer/index.html` (CSP), `electron.vite.config.mts` (dev CSP transform, `MAIN_VITE_*` defines)
- `App.tsx`
- `screens/SecurityGate/SecurityGate.types.ts` and `.tsx` (`onSignOut`, offline and config states)
- `layouts/LockdownShell` (copy, cut and paste listeners; violation message prop)
- `components/LockdownBanner` (warning message)
- `playwright.config.mts` (globalSetup and teardown, timeout 90 s)
- `e2e/smoke.spec.ts`
- `package.json` (`zod`, `test:main`)
- `tsconfig.node.json` (include `src/shared`)
- `.gitignore` (`e2e/.run/`)

### 14.4 Repo and docs
- **Change:**
  - `vitest.config.ts` (projects: add `desktop/vitest.main.config.mts`)
  - `.github/workflows/ci.yml` (e2e job: Mongo binary cache, env, timeout)
  - `.env.example`
  - `eslint.config` (`no-restricted-globals` for the renderer; `no-restricted-imports` of `electron` outside `main/electron/ports.ts` and preload)
- **Docs:**
  - `docs/api/contract.md`: the gate section, the 4 routes, error codes, U15 wording, `ACCESS_RESTRICTED` semantics, inventory count
  - `docs/architecture/data-model.md`: 3 collections plus `gateRestriction`
  - `docs/design/screens.md`
  - README: running e2e locally; the honest-limits section
  - ADR 0004 follow-up pointer to 0014; ADR 0010 pointer to 0017; ADR 0011 amendment for the gate tier (D5-6)
  - `docs/security/manual-lockdown-checklist.md`: the section 7.6 list as Phase 9 manual test steps

## 15. Implementation sequence (two tracks; the contract freezes first)
**Step 0, together, about half a day: freeze the contract.**
- Shared schemas and DTOs (`schemas/gate*.ts`), error codes, `IPC_CHANNELS_V1` and its schemas (`desktop/src/shared/ipc.ts`), and `contract.md`.
- Both tracks code against these. Changes after the freeze need both engineers.

**Server track (backend-engineer):**
1. S-1 Shared pure logic: `gateScore`, Behavioural v2, gate XP, reference formatter, authoring schema, with tests (12.1).
2. S-2 Models plus indexes plus start-up verification, `User.gateRestriction`, model tests.
3. S-3 Config keys (`env.ts`, `appConfig`, `.env.example`, `env.test`).
4. S-4 `AuthContext.accessRestricted`, `RouteDef.allowWhileRestricted`, access-gate enforcement, registry validation, the B1/B2/B3 updates (no gate routes yet, so the restricted sweep uses a test route).
5. S-5 Gate service and routes: status, challenge, attempts (compare-and-set), seed content, GT1–GT5 and GT9–GT16.
6. S-6 Restriction side effects: `CRITICAL_EVENT_POLICY`, `recordCriticalEvent` tier, user flag, risk and XP hooks, GT6–GT8.
7. S-7 Restore route plus audit plus escalation note, GT17–GT19.
8. S-8 Reconcile and sweeper repair, failure injection, GT20–GT23, RV1–RV3.
9. S-9 `testing/e2eServer.ts` plus the `seed:gate:dev` script.

   Hand-off to the desktop track: a running harness and an API matching the frozen DTOs.

**Desktop track (frontend-engineer):**
1. D-1 `ports.ts`, `config.ts` (URL policy), `log.ts`, `hardening.ts`, `protocol.ts` (`app://`), CSP, command-line guard, CFG and LOG tests, updated smoke (bridge keys pending).
2. D-2 `ipc/registry.ts` plus preload v1 plus `bridge.d.ts` plus sender validation, IPC1–IPC8.
3. D-3 `tokenStore`, `apiClient` (operations table, single-flight), `sessionService`, TS and AC tests. Develops against `seed:learning:dev` plus `seed:gate:dev` on a local server.
4. D-4 `appLock`, `inputFilter`, `covers`, `gateController`, GC and IF tests.
5. D-5 `lockdownController`, LC tests.
6. D-6 Renderer wiring: `AppRouter`, Login, SecurityGate, `TrainingHome`, Quiz and LockdownShell, renderer tests, axe.
7. D-7 `reminderScheduler`, tray, auto-start, NT tests.
8. D-8 E2E: support files, the four specs, CI changes (needs S-9).

**Together:**
- J-1 ADR status flip, docs.
- J-2 `/verify`, then the manual Windows checklist (section 7.6 items observed and recorded).
- J-3 security-tester review against section 10.
- J-4 PR.

Parallelism: S-1..S-8 and D-1..D-7 run in parallel after Step 0. Only D-8 waits for S-9.

## 16. Not requirement-backed (flagged for approval)
- `POST /gate/challenge` (a fourth route beyond the reserved three; keeps GET side-effect free)
- Clearance TTL and `GATE_CLEARANCE_TTL` (derived from R1 plus usability)
- `ORG_TIMEZONE` (needed by gate XP days and reference ids)
- The tray icon and hide-on-close (derived from R5: reminders need a running app)
- The custom `app://` protocol
- The egress filter and separate API session
- The IPC rate guard
- The renderer-crash resume
- Content protection (derived from R4 "restrict … while a quiz is active"; screenshots are the PrintScreen requirement)
- The `GATE_UNAVAILABLE` audit warning
- `TrainingHome` (a temporary screen for the gate e2e; replaced in Phase 6)
- The cover windows on secondary displays (derived from R6)
- `build/fuses.config.ts` (prepared now, applied in Phase 10)
- The manual lockdown checklist document

## 17. Decisions needed (recommended default in bold; each can be approved as is)
1. **D5-1 Gate placement (resolves U15).** **The window locks pre-authentication at start-up. The challenge is served post-authentication (employee token). Failed logins never count as gate attempts.** Alternative: an anonymous pre-login question (rejected: no subject to restrict, resettable, and a DoS lever).
2. **D5-2 Required interaction.** **One question from a dedicated gate pool (3 to 6 options). A new question per attempt; explanation shown; the correct option never shown. 30 seeded questions; authoring in Phase 7.** Alternative: re-ask the same question (always passable by elimination).
3. **D5-3 Retries.** **3 attempts per run (`GATE_MAX_ATTEMPTS`). Counted across restarts, sessions and workstations. Reset only by a pass or an admin restore.**
4. **D5-4 When the gate is required.** **Shown at every start-up, unlock and resume. A new question once the last pass is older than `GATE_CLEARANCE_TTL` = 12h (about once per working day).** Alternatives: every launch; once per calendar day.
5. **D5-5 Meaning of "restricted access".** **The gate window stays up (workstation covered) showing the restricted screen and reference until an admin restores access. The server refuses all employee routes except the four allowlisted.** Alternative: the workstation is usable, only CSense training is blocked. Product must confirm; this blocks a person from working.
6. **D5-6 Escalation for restriction.** **Reuse `gate_access_restricted` (no new reason): `critical`, review tier `security_team` (the requirement says "alert the security team"). This amends ADR 0011's `management` row through a shared `CRITICAL_EVENT_POLICY`.** Alternative: keep `management` as in ADR 0011, which needs a `managementReference` to resolve. Either way, a different administrator must resolve it (critical).
7. **D5-7 Restore access.** **Admin-only route in Phase 5 (UI in Phase 7). Needs the escalation acknowledged (`GATE_RESTORE_REQUIRES_ACK=true`) and a note. Audited as `gate.access_restored` (warning). Adds an escalation note. Does not resolve the escalation.**
8. **D5-8 Server enforcement scope.** **Enforce only the restricted state server-side (403 `ACCESS_RESTRICTED`). Do not require a gate clearance on learning routes.** Alternative: `GATE_REQUIRED` on all employee routes without a clearance (stronger against a modified client, large test churn, breaks quizzes across clearance expiry).
9. **D5-9 Gate XP.** **10 XP per organisation-local day for a pass whose first answer was correct (`ORG_TIMEZONE`, default UTC). Defender then needs about 53 such days after a perfect course.** Alternatives: no gate XP (Defender unreachable until the flags); 25 XP (about 21 days).
10. **D5-10 Risk model v2.** **The gate score = share of the last 20 runs with a wrong first answer + 35 per restriction (at most 2), capped at 100. Behavioural = 70 gate / 30 v1 when both exist, else whichever exists. `RISK_MODEL_VERSION=2`, rolled out with `gamification:reconcile --all`.** Constants are provisional, as with D4-9.
11. **D5-11 Administrators at the gate.** **An administrator sign-in releases the gate without a challenge (`/gate/*` stays employee-only).** Alternative: administrators answer too (needs `/gate/*` for both roles and admin XP semantics).
12. **D5-12 Offline or unavailable API.** **Fail open after 120 s with an explicit "Continue offline", logged locally. The gate re-locks as soon as the API is reachable and no clearance exists.** Alternative: `closed` (no offline access; an outage blocks every workstation). The build flag supports both.
13. **D5-13 Session persistence.** **Persist the refresh token with safeStorage across restarts (7-day absolute), so the Sign-in step resumes silently. If encryption is unavailable, memory-only (sign in every launch); never plaintext.** Alternative: always require credentials at start-up.
14. **D5-14 API access path.** **Main-process proxy with a closed operations table; the renderer never sees any token (ADR 0014; closes the ADR 0004 follow-up).** Alternative: give the renderer the access token only (rejected: XSS exfiltration, split refresh logic).
15. **D5-15 Focus loss.** **Warn on each loss; auto-abandon at the 3rd loss or after 15 s away; ignore blurs under 500 ms.** Alternatives: warn only; abandon on the first loss.
16. **D5-16 Crash and hang.** **One renderer reload with resume per session (answers lost, questions kept); the second crash, or a 10 s hang followed by a crash, abandons and exits.** Alternative: always abandon on crash.
17. **D5-17 Clipboard.** **Clear on enter and on exit; block copy, cut and paste in-window. No periodic clearing (it would destroy unrelated user data and adds nothing once paste is blocked). The quiz intro copy tells the user the clipboard will be cleared.**
18. **D5-18 Screen capture.** **`setContentProtection(true)` during lockdown, plus a best-effort PrintScreen global shortcut.** Alternative: none (PrintScreen requirement only partially met).
19. **D5-19 Escape key in lockdown.** **Escape reaches the renderer only to close the exit dialog and never exits lockdown (amends screens.md "Esc is blocked").**
20. **D5-20 Custom protocol.** **Serve the renderer from `app://csense` instead of `file://`.**
21. **D5-21 Reminders.** **Client-side in main from `GET /modules`: continue training, quiz available again, final unlocked. At most 2 per day, none during gate, lockdown or focus. Generic text. Click opens the app. Server-driven reminders arrive with Phase 7 due dates.**
22. **D5-22 Tray.** **After release, closing the window hides it to the tray (Open, Sign out, Quit). Quit is allowed only when unlocked.**
23. **D5-23 Auto-start.** **Packaged builds register a per-user login item (removable by the user). Machine-wide, non-removable start is Phase 10 (GPO or Intune).**
24. **D5-24 Rate limits behind NAT (D-10).** **No code change in Phase 5; document sizing in `.env.example` (about 120 to 150 concurrent start-ups per egress IP at the defaults). Topology confirmation stays a Phase 10 roll-out prerequisite.** Alternative: key the global limiter by verified user id for authenticated requests now.
25. **D5-25 Exit reason on abandoned attempts.** **Not recorded in Phase 5 (focus-loss abandons already count in conduct as `abandoned`).** Alternative: an optional `{ reason }` on the abandon routes stored on QuizAttempt (a Phase 3 schema change), useful for the Phase 7 admin view.
26. **D5-26 Phase 5 UI scope.** **Wire Login, SecurityGate, a temporary `TrainingHome` and the Quiz lockdown only; module player, review and dashboard stay in Phase 6. The e2e seed pre-completes module 1's content.**
27. **D5-27 E2E backend.** **A compiled, env-guarded `server/src/testing/e2eServer.ts` spawned as a child process by Playwright `globalSetup`, with mongodb-memory-server. CI runs it on windows-latest (ADR 0018).** Alternative: a MongoDB service container (not available on Windows runners).

Open questions in CLAUDE.md that touch this phase:
- Client identity: affects the contact text, AUMID and branding. The default keeps them configurable and generic.
- Phishing scope: unaffected.

## 18. Risks
1. **Overstated enforcement.** Stakeholders may read "gate" as an OS lock. Mitigation: section 2 and ADR 0015 say plainly what user space can do, and Phase 10 lists the fleet controls. The product owner signs off D5-5 and D5-12 knowingly.
2. **Locking people out** (D5-5 plus slow security-team response). Mitigations: the restricted poll releases automatically within 60 s of a restore, the reference id on screen, the Sign-out link, and the escalation `critical`. Phase 7 adds OS notifications to administrators. Until then the alert is in-app plus a log line (ADR 0011), which is weak for an urgent unlock.
3. **Windows focus-stealing rules.** `focus()` from a background process may only flash the taskbar, so refocus after Alt+Tab is best-effort. The always-on-top level keeps the gate visible; the focus policy handles quizzes. Confirmed on real hardware in J-2.
4. **Synthetic input vs real keyboard.** CDP-dispatched keys may not exercise exactly the real path. The filter decision table is unit-tested, e2e uses `sendInputEvent` where needed, and a manual checklist covers real keys.
5. **Electron API drift** (Electron 45): `setContentProtection`, `isContentProtected`, `session.fetch`, `protocol.handle`, `getSelectedStorageBackend`. Pin the Electron version for the phase; a smoke test asserts each API exists.
6. **Refresh-token crash window.** A crash between server rotation and local persistence logs the user out (reuse detection). Accepted as the secure outcome; persistence happens immediately after the response.
7. **False focus-loss abandons** (UAC prompts, meeting pop-ups that steal focus). They cost an attempt and add Behavioural risk. Mitigations: thresholds, the 500 ms debounce, configurable values; product may choose warn-only (D5-15).
8. **Clipboard history and sync** (Win+V, cloud clipboard) keep earlier entries that `clipboard.clear()` does not remove. Documented; Phase 10 policy `AllowClipboardHistory=0`.
9. **E2E fragility on windows-latest:** the MongoDB binary download (cached), kiosk and always-on-top on a headless desktop session (GitHub Windows runners have an interactive session; verify early in D-8), timing of polls. Fallback: run the e2e lockdown assertions on window state through `app.evaluate` rather than pixels.
10. **Risk model v2 roll-out** changes Behavioural for everyone with gate data and may move some employees into High. Expected and audited (D4-25), but announce it to the security team.
11. **Rate limits behind NAT** at morning start-up peaks (D-10, D5-24).
12. **Phase 3/4 code is still moving** (PR 3 and PR 4 open). The plan names `recordCriticalEvent`, `riskFacts.service`, `authenticateBearer` and markers as they are in the Phase 4 worktree today. Rebase before S-4/S-6.
13. **Gate content quality.** Weak distractors make the gate trivial; strong ones make restriction common. The seed is generic; the client's security team should review the pool before roll-out (Phase 7 authoring).
14. **Personal data.** Gate answers and restrictions are HR-adjacent. Admin-only, no answers in logs or audit metadata, retention set in Phase 10.

## 19. Phase 5 acceptance checklist
**Setup**
- [ ] PR 3 and PR 4 are merged to `main`; branch `phase-05-desktop-gate` is cut from `main`; Conventional Commits; no direct commits to `main`.
- [ ] D5-1..D5-27 are answered; ADR 0013–0018 are set to Accepted (or amended); ADR 0004, 0010 and 0011 carry pointers or amendments.
- [ ] The only new runtime dependency is `zod` in desktop (already in the tree); `npm audit --audit-level=high` is clean.

**Shared**
- [ ] Gate schemas are strict with no key fields (GS1–GS4); authoring schema GQ1.
- [ ] `gateScore`, Behavioural v2 (with the 37.5 → 38 case), `RISK_MODEL_VERSION === 2` and gate XP are pure and unit-tested (GR, BV, XPG); the 30/25/30/15 weight tests stay green.

**Server**
- [ ] `gatequestions`, `gateruns` (one open run per employee), `gateanswers` (append-only, unique per run attempt) and `User.gateRestriction` exist; the unique indexes are verified at start-up and in `/health/ready`.
- [ ] `GET /gate/status`, `POST /gate/challenge`, `POST /gate/attempts` and `POST /admin/users/:userId/restore-access` behave per section 6.5; the B1 inventory is updated and reviewed.
- [ ] Attempts cannot be forged, replayed, raced or reset (GT9–GT15); no response leaks a key (GT16).
- [ ] Retry exhaustion restricts. It opens exactly one `gate_access_restricted` critical escalation with tier per D5-6, plus `governance.critical_event_recorded` and `escalation.opened`; `audit:verify` passes (GT6).
- [ ] A restricted employee gets 403 `ACCESS_RESTRICTED` on every non-allowlisted employee route (GT7). Restore needs an acknowledged escalation and a note, is audited with the note hash only, and gives fresh attempts (GT17–GT19).
- [ ] Partial failures are repaired by reconcile and the sweeper (GT20–GT22). A pass awards gate XP once per day. Restriction and passes recompute risk v2 (RV1–RV3).

**Desktop main**
- [ ] contextIsolation, sandbox, no nodeIntegration, no webview, `app://` origin, navigation, window-open and permission locks, egress filter, CSP `connect-src 'self'`.
- [ ] The API URL policy refuses non-https in packaged builds and non-loopback http in development (CFG1–CFG8); no `CSENSE_*` override is honoured when packaged.
- [ ] Every IPC channel is zod-validated with sender checks; there is no generic passthrough; the channel inventory snapshot is reviewed (IPC1–IPC8).
- [ ] The refresh token is only in main memory and in the safeStorage-encrypted file; memory-only when encryption is unavailable; single-flight refresh; logout wipes (TS1–TS9, AC1–AC9).
- [ ] The gate controller releases only on a server grant, re-locks on clearance expiry, unlock or resume, and follows the offline policy (GC1–GC10).
- [ ] Lockdown is entered only through a main-started session. It clears and blocks the clipboard, blocks the input-filter table, keeps devtools closed, applies content protection, enforces the focus policy, recovers from crash and hang, has a hard cap, and is always exitable (LC1–LC14, IF1).
- [ ] Reminders follow D5-21 (NT1–NT6); the main log redacts secrets (LOG1).

**E2E (Playwright Electron, windows-latest, in-process backend)**
- [ ] `gate.spec.ts`: the app launches locked into the gate, escapes fail, and access is granted only after a correct answer; a relaunch within the clearance auto-continues.
- [ ] `gate.restricted.spec.ts`: three wrong answers give the restricted state, which persists across a relaunch; an admin restore via the API returns a fresh challenge.
- [ ] `lockdown.spec.ts`: lockdown is active during a quiz; every escape listed in section 11 fails; focus loss warns, then abandons; a crash resumes, then exits; keyboard-only exit works; submit exits lockdown.
- [ ] `security.spec.ts` and the updated `smoke.spec.ts`: no token in renderer storage or bridge results; renderer fetch is blocked; a bad API URL is refused with zero requests; the bridge key set is exact.

**Docs and Definition of Done**
- [ ] `contract.md`, `data-model.md`, `screens.md`, `.env.example` (server gate keys, desktop keys, NAT sizing note), README (honest limits, e2e locally) and `docs/security/manual-lockdown-checklist.md` are updated.
- [ ] `npm run lint`, `typecheck`, `test` (shared, server, desktop renderer, desktop-main), `build`, `format:check` and `test:e2e` pass; CI is green on Windows and Ubuntu; the Phase 0–4 suites are still green.
- [ ] The manual Windows checklist (section 7.6) has been run once on a real machine and the results recorded in the PR.
- [ ] The security-tester review against section 10 (S1–S24) has no open High or Critical findings; `/verify` passes.
