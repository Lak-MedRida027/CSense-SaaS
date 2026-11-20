# Phase 6 plan: the employee experience

- Status: **Draft 2026-11-10, awaiting approval.** Decisions D6-1 to D6-20 are in section 17. Four of them (D6-1, D6-4, D6-5, D6-6) need an explicit product-owner answer; the rest can be approved as recommended.
- Branch: `phase-06-employee-experience`, cut from `main` (Phases 0 to 5 merged). Where this plan names Phase 3 to 5 internals and the code differs, the code wins; every route, DTO and channel below was checked against the code on this branch.
- New ADRs (Proposed): 0019 module media delivery and the "watched" rule; 0020 employee journey: bridge v1 extension, closed-book rule and onboarding state.
- Writes no feature code. Every item maps to a requirement in section 1, or is flagged in section 16.

## 0. Inputs read and the state this plan builds on
- `CLAUDE.md` (golden rules, security baseline, open questions), `BUILD_PLAYBOOK.md` Phase 6 (plan prompt, build prompt, gate).
- **Client Needs doc: not read.** It is a binary `.docx` and none of my tools can open it. Requirements come from the earlier plans, which quote it (N1 to N5 in Phase 3, G1 and G2 in Phase 4, R5 in Phase 5), and from `contract.md` (FR4 onboarding) and ADR 0001 (NFRs: dark-mode-primary UI, CDN media). Section 18 lists what this leaves untraced.
- Both UML PNGs. Use cases in scope: View Learning Content, Complete Learning Module (includes Take Module Quiz, extended by Award Badge), Take Module Quiz, Take Final Assessment (both include Update Risk Profile, server side), View Progress Dashboard. Class UML: `Employee.viewDashboard(): View`, `Employee.completeModule(m)`, `Employee.totalXP`, `level`, "earns" Badge.
- Plans: Phase 3 (ADR 0006, 0007, 0008), Phase 4 (ADR 0009 to 0012), Phase 5 (ADR 0013 to 0018), `data-model.md`, `contract.md`, `docs/design/{screens,components,accessibility}.md`, ADR 0003.
- **Server code (routes actually registered, 36):**
  - Learning (`features/learning/learning.routes.ts`, all `EMPLOYEE_ONLY`): `GET /modules`, `GET /modules/:moduleId`, `POST /modules/:moduleId/start`, `POST /modules/:moduleId/exercises/:exerciseId/answers`, `POST /modules/:moduleId/content/complete`, `GET /modules/:moduleId/quiz`, `POST .../quiz/sessions`, `POST .../quiz/sessions/:sessionId/abandon`, `POST .../quiz/attempts`, `GET /final-test`, `POST /final-test/sessions`, `POST /final-test/sessions/:sessionId/abandon`, `POST /final-test/attempts`, `GET /me/attempts`, `GET /me/attempts/:attemptId`.
  - Gamification (`gamification.routes.ts`): `GET /me/xp` (`XpSummaryDTO`), `GET /me/badges` (`MyBadgesDTO`). No `/me/risk` (D4-22).
  - Auth: `GET /auth/me` returns `toUserDTO` (`totalXP`, `level` for employees).
  - Not implemented but reserved in the contract for Phase 6: `GET /me/dashboard`, `GET /me/progress`, `PATCH /me/onboarding` (FR4).
- **Shapes that matter** (`shared/src/schemas/learningResponses.ts`): `ModuleDetailDTO.content` = `{ body, keyTakeaways, video: { url, captionsUrl, transcript[] } | null, exercises: { exerciseId, prompt, artifact, options }[] }` (no keys); `ExerciseFeedbackDTO` = `{ exerciseId, selectedIndex, correct, correctIndex, explanation, recorded }`; `QuizOverviewDTO` and `FinalTestOverviewDTO` carry `canStart`, `blockedReason` (incl. `cooldown`) and `cooldownUntil`; `AttemptResultDTO` already contains `review[]` (per the reveal policy), `progression` and `effects { xpEarned?, badge? }`.
- **Desktop code:**
  - `main/api/operations.ts`: closed table of 16 operations, methods `GET | POST` only.
  - `shared/ipcChannels.ts`: `IPC_CHANNELS_V1` = session (3), gate (5), assessment (4), learning (2) = 14 invoke channels; `ipc.ts` strict input schemas; `ipc/registry.ts` with a flat 20 calls/s guard; `ipc/handlers.ts` (`learning.*` return `GATE_LOCKED` unless `gate.isReleased()`).
  - `lockdown/lockdownController.ts` exposes `isActive()`.
  - `security/policy.ts`: `PRODUCTION_CSP` has `media-src 'none'`; `protocol.ts` reads whole files, no Range, no media MIME types; the scheme has no `stream` privilege.
  - Renderer: `AppRouter` (boot, login, gate, `Workspace`), `Workspace` (`HomeContainer` = temporary `TrainingHome`, `QuizContainer`), `store.ts`. Phase 1 screens with typed props: `OnboardingScreen`, `ModulePlayerScreen`, `EmployeeDashboardScreen`, `QuizScreen` (with `QuizReview`, `QuizResult`). No renderer storage is used anywhere today.
  - E2E: `gate.spec`, `gate.restricted.spec`, `lockdown.spec`, `security.spec`, `smoke.spec`, `styleguide.a11y.spec`; harness `server/src/testing/e2eServer.ts` (accounts `admin`, `admin2`, `gate-pass`, `gate-fail`, `quiz`; gate key only; identity shuffle). Playwright: 1 worker, 90 s per test, CI job 30 min.
- **Gaps found in the Phase 1 screens** (fixed in this phase, section 7.3): `ModulePlayerScreen` has no lesson body, no loading, error or locked state, and shows exercises in the lesson stage for interactive modules; `QuizScreen` intro cannot show a cooldown; `InteractiveExercise` cannot show a pending state or the correct option; `VideoPlayerFrame` has no error callback; `TranscriptPanel` cannot report "read to the end"; no Settings surface exists although onboarding says "You can change these later in Settings".

## 1. Requirements in scope (traceability keys)
| Key | Requirement (source) |
|---|---|
| N1 | Sequential locked modules; the next unlocks only after the current quiz is passed (Needs, via Phase 3) |
| N2 | Video lessons and interactive exercises with immediate right/wrong feedback and short explanations (Needs, via Phase 3) |
| N3 | A multiple-choice quiz per module with a pass threshold; review answers and retry on failure (Needs, via Phase 3) |
| N4 | A final assessment of about 15 questions after all modules (Needs, via Phase 3) |
| N5 | 7 modules assumed; threshold configurable per module, default 70 %; no offline caching (Needs assumptions, CLAUDE.md) |
| FR4 | Onboarding / welcome for a first-time employee (contract `PATCH /me/onboarding` "FR4"; data model "onboarding flag (6)") |
| G1 | XP and the five-level ladder visible to the employee (Needs, via Phase 4) |
| G2 | A named badge per completed module (Needs, via Phase 4; UC Award Badge) |
| UC-D | View Progress Dashboard: modules, scores, XP, level, badges (UML; `Employee.viewDashboard()`) |
| UC-F | Take Final Assessment, entry and result (UML) |
| R4 | Quizzes run in kiosk/lockdown mode (CLAUDE.md; Phase 5 ADR 0016) |
| R7 | Renderer never holds a token; main is the only API client (ADR 0014) |
| D17 | Employees never see their own risk (Phase 1 D17, D4-22) |
| A11Y | WCAG 2.1 AA, captions for prerecorded video (1.2.2), text alternative (1.2.3), keyboard, reduced motion (Phase 1 targets) |
| NFR-UI | Dark-mode-primary UI, coherent design system (ADR 0001, ADR 0003) |
| G | Playbook gate: a seeded employee completes first login, onboarding, modules, quizzes, dashboard and final assessment in the running app; the dashboard shows real XP, level and badges; the e2e journey test is green; `/verify` is green |

Out of scope:
- Phase 7: admin console; content authoring (including real media URLs); module assignment; restore-access UI; phishing UI (flag stays off).
- Phase 8 and 9: coverage campaign and the adversarial pass (this plan lists the properties to attack, section 10).
- Phase 10: CDN/remote media mode, packaging of the media pack as `extraResources`, signed installers.
- Not required: offline caching of content (N5), past-attempt history browsing (D6-13), employee-visible risk (D17).

## 2. Open questions in CLAUDE.md and the assumptions used
| Question | Assumption in Phase 6 |
|---|---|
| Module count 6 vs 7 | **Data-driven.** No screen hard-codes 7: counts, "Module N of M" and the onboarding copy come from `LearningOverviewDTO.totalModules`. The seed has 7, the e2e asserts the seed's count. |
| Pass threshold "3 of 5" vs 70 % | **Per quiz, from the DTO** (`QuizOverviewDTO.passingScore`, `AssessmentSessionDTO.passingScore`). Onboarding, which has no quiz yet, says "usually 70 %" from `DEFAULT_PASSING_SCORE`. |
| Phishing and continuous review | **Flags stay off; nothing employee-facing is built.** No nav item, no call to `/config/features` is needed in Phase 6. |
| Client identity | **Generic copy and neutral brand.** Onboarding text and badge names come from the seed or generic strings. |

## 3. Architecture overview
```
renderer (untrusted, app://csense)
  AppRouter: boot | login | gate | Workspace
  Workspace (view state machine, section 7.1)
    onboarding -> dashboard <-> modules | badges | final | settings dialog
                  module player (lesson -> practice -> quiz entry) -> quiz (lockdown) -> result/review -> achievement
  data layer: learningStore (overview, xp, badges cache) + mappers (DTO -> screen props) + preferences (localStorage)
        | window.csense (bridge v1, 22 invoke channels + 1 event)
preload (frozen, table-driven from IPC_CHANNELS_V1)
        | ipcRenderer.invoke('csense:v1:<area>.<method>')
main (trusted)
  IpcRegistry: sender check -> IPC_CHANNEL_POLICY (release, lockdown, rate) -> size cap -> zod -> handler
  handlers -> ApiClient (operations table, strict response schemas) -> /api/v1
  mediaResolver (content URLs -> app://csense/media/<file> | null)
  app:// protocol: renderer bundle + /media/ (manifest allowlist, Range)
```
One new server route (`PATCH /me/onboarding`) and one model field. Everything else reuses Phase 3 and 4 endpoints.

## 4. API calls: every call of the journey
### 4.1 Server endpoints used (existing unless marked NEW)
| # | Journey step | Method and route | Response (shared schema) | Existing? |
|---|---|---|---|---|
| A1 | Session start, onboarding decision | `POST /auth/login` (`user`), `GET /auth/me` | `EmployeeDTO` + **new `onboarding` field** | existing, DTO extended |
| A2 | Onboarding finished or skipped | `PATCH /me/onboarding` `{ outcome }` | `OnboardingStateDTO` | **NEW** (reserved FR4) |
| A3 | Dashboard, Modules page, player sidebar, final card | `GET /modules` | `LearningOverviewDTO` | existing |
| A4 | Dashboard level, XP, ladder; level-up detection | `GET /me/xp` | `XpSummaryDTO` | existing |
| A5 | Dashboard badges, Badges page | `GET /me/badges` | `MyBadgesDTO` | existing |
| A6 | Open a module | `GET /modules/:moduleId` | `ModuleDetailDTO` (mapped by main, 4.4) | existing |
| A7 | First open of an unlocked module | `POST /modules/:moduleId/start` | `ModuleProgressDTO` | existing |
| A8 | Answer a practice exercise | `POST /modules/:moduleId/exercises/:exerciseId/answers` `{ selectedIndex }` | `ExerciseFeedbackDTO` | existing |
| A9 | Leave the content for the quiz | `POST /modules/:moduleId/content/complete` | `ModuleProgressDTO`; 409 `CONTENT_INCOMPLETE` | existing |
| A10 | Quiz intro (attempt no., cooldown) | `GET /modules/:moduleId/quiz` (also embedded in A6) | `QuizOverviewDTO` | existing |
| A11 | Start, submit, exit a quiz | `POST .../quiz/sessions`, `.../quiz/attempts`, `.../abandon` (through `assessment.*`, lockdown) | `AssessmentSessionDTO`, `AttemptResultDTO` | existing (Phase 5 wiring) |
| A12 | Final assessment entry | `GET /final-test` | `FinalTestOverviewDTO`; 404 when none exists | existing |
| A13 | Final start, submit, exit | `POST /final-test/sessions`, `/final-test/attempts`, `.../abandon` | as A11 | existing (Phase 5 wiring) |

Not used: `GET /me/attempts[/:id]` (the review comes inside `AttemptResultDTO`; history browsing is D6-13), `/me/dashboard` and `/me/progress` (D6-3: removed from the contract), `/config/features`.

### 4.2 The one new server endpoint: `PATCH /me/onboarding` (backend track)
Justification: FR4 is a reserved contract route; a server flag shows onboarding once per employee rather than once per workstation (shared desks, hot-desking), and it is the planned "onboarding flag (6)" in `data-model.md`. Alternative in D6-1.

| Aspect | Specification |
|---|---|
| Access | `EMPLOYEE_ONLY` (admin 403; restricted employee 403 `ACCESS_RESTRICTED`, picked up by the GT7 sweep) |
| Body | `onboardingRequestSchema = z.object({ outcome: z.enum(ONBOARDING_OUTCOMES) }).strict()`, `ONBOARDING_OUTCOMES = ['completed', 'skipped']` |
| Algorithm | `Employee.findOneAndUpdate(trusted({ _id: userId, role: 'employee', onboarding: null }), { $set: { onboarding: { outcome, at: clock() } } }, { new: true })`; if null, read the existing value. **First write wins**; a repeat returns the stored state. |
| Success | 200 `OnboardingStateDTO = { outcome: 'completed' \| 'skipped', at: string }` (strict schema in `shared/src/schemas/onboardingResponses.ts`) |
| Errors | 400 (`VALIDATION_ERROR`; extra fields, unknown outcome), 401, 403 |
| Audit | None (not a security event). No XP, no risk input (Engagement stays D4-11). |
| Model | `Employee.onboarding`: sub-schema `{ outcome: enum, required; at: Date, required }`, `_id: false`, `strict: 'throw'`, default `null`. No index. |
| DTO | `EmployeeDTO.onboarding: OnboardingStateDTO \| null` (`toUserDTO`), so login, `/auth/me` and `POST /admin/users` all carry it. |

### 4.3 New main-process operations (`desktop/src/main/api/operations.ts`)
`Operation.method` widens to `'GET' | 'POST' | 'PATCH'`; `ApiClient` sends PATCH with a JSON body exactly like POST. Path params are validated, lower-cased ObjectIds and `encodeURIComponent`-ed, as today.

| Operation id | Method, path | Params / body schema | Response schema | Success |
|---|---|---|---|---|
| `modules.detail` | GET `/modules/${moduleId}` | `{ moduleId }` / none | `moduleDetailSchema` | 200 |
| `modules.start` | POST `/modules/${moduleId}/start` | `{ moduleId }` / none | `moduleProgressSchema` | 200 |
| `modules.answerExercise` | POST `/modules/${moduleId}/exercises/${exerciseId}/answers` | `{ moduleId, exerciseId }` / `exerciseAnswerRequestSchema` | `exerciseFeedbackSchema` | 200 |
| `modules.completeContent` | POST `/modules/${moduleId}/content/complete` | `{ moduleId }` / none | `moduleProgressSchema` | 200 |
| `final.overview` | GET `/final-test` | none | `finalTestOverviewSchema` | 200 |
| `me.xp` | GET `/me/xp` | none | `xpSummarySchema` | 200 |
| `me.badges` | GET `/me/badges` | none | `myBadgesSchema` | 200 |
| `me.onboarding` | PATCH `/me/onboarding` | none / `onboardingRequestSchema` | `onboardingStateSchema` | 200 |

`userResponseSchema` (non-strict, bounded) gains `onboarding: z.object({ outcome: z.enum(...), at: z.string().max(40) }).strict().nullable().optional()`. Any response that fails its strict schema (an extra field such as a leaked `correctAnswer`) becomes `BAD_RESPONSE` and never reaches the renderer.

### 4.4 Bridge v1 additions (`desktop/src/shared/ipcChannels.ts`, `ipc.ts`, `preload/index.ts`)
```ts
IPC_CHANNELS_V1 = {
  session:    ['getState', 'login', 'logout'],
  gate:       ['getView', 'requestChallenge', 'submitAnswer', 'continue', 'continueOffline'],
  assessment: ['startSecure', 'resume', 'submit', 'exit'],
  learning:   ['getOverview', 'getQuizOverview',
               'getModule', 'startModule', 'answerExercise', 'completeContent', 'getFinalTestOverview'],
  me:         ['getXp', 'getBadges', 'completeOnboarding'],
}   // 22 invoke channels + csense:v1:event; bridgeVersion stays 1 (D6-9)
```
| Channel | Input schema (strict, main only) | Operation(s) | Result type | Policy (D6-8, D6-10) |
|---|---|---|---|---|
| `learning.getOverview` (exists) | none | `modules.list` | `Result<LearningOverviewDTO>` | release, deny in lockdown, 20/s |
| `learning.getQuizOverview` (exists) | `{ moduleId: id }` | `modules.quizOverview` | `Result<QuizOverviewDTO>` | release, deny, 20/s |
| `learning.getModule` | `{ moduleId: id }` | `modules.detail` + media mapping | `Result<ModuleDetailView>` | release, deny, 20/s |
| `learning.startModule` | `{ moduleId: id }` | `modules.start` | `Result<ModuleProgressDTO>` | release, deny, **2/s** |
| `learning.answerExercise` | `{ moduleId: id, exerciseId: id, selectedIndex: int 0..MAX_OPTIONS-1 }` | `modules.answerExercise` | `Result<ExerciseFeedbackDTO>` | release, deny, **5/s** |
| `learning.completeContent` | `{ moduleId: id }` | `modules.completeContent` | `Result<ModuleProgressDTO>` | release, deny, **2/s** |
| `learning.getFinalTestOverview` | none | `final.overview` | `Result<FinalTestOverviewDTO>` | release, deny, 20/s |
| `me.getXp` | none | `me.xp` | `Result<XpSummaryDTO>` | release, deny, 20/s |
| `me.getBadges` | none | `me.badges` | `Result<MyBadgesDTO>` | release, deny, 20/s |
| `me.completeOnboarding` | `{ outcome: 'completed' \| 'skipped' }` | `me.onboarding`, then session view update + `session` event | `Result<OnboardingStateDTO>` | release, deny, **1/s** |

New types (type-only, preload-safe):
```ts
type ModuleDetailView = Omit<ModuleDetailDTO, 'content'> & {
  content: Omit<ModuleDetailDTO['content'], 'video'> & {
    video: { src: string | null; captionsSrc: string | null;          // app://csense/media/... or null
             transcript: { id: number; startSeconds: number; text: string }[] } | null;
  };
};
interface SessionUserView { id; name; role; level?; totalXP?; onboardingRequired?: boolean } // true iff employee && onboarding === null
DESKTOP_ERROR_CODES += 'LOCKDOWN_ACTIVE'
IPC_CHANNEL_POLICY: Record<IpcMethodKey, { requiresRelease: boolean; duringLockdown: 'allow' | 'deny'; ratePerSecond: number }>
```
- The registry reads `ratePerSecond` from the policy (default 20); `assertIpcRegistry` also fails start-up if a channel has no policy entry.
- `learning.*` and `me.*` handlers go through one wrapper `journeyCall(op, input)`: refuse `GATE_LOCKED` unless released, refuse `LOCKDOWN_ACTIVE` while `lockdown.isActive()`, call the API, and on `ACCESS_RESTRICTED` call `gate.noteRestricted()` (exposes the existing re-check path) before returning the error.
- `assessment.*`, `session.*` and `gate.*` keep their Phase 5 behaviour; their policy rows record it (`duringLockdown: 'allow'`).
- Reminder notifications keep calling `modules.list` directly in main (not through IPC); unaffected by the closed-book rule.

## 5. Video, captions and the "watched" rule (ADR 0019)
### 5.1 Where media comes from now (D6-4)
- `desktop/resources/media/`: `placeholder-lesson.webm` (in-house, silent title card "Lesson video placeholder", VP9, at most 8 s and 500 KB; `README.md` records the `ffmpeg` command and that it is original work, no third-party licence), `m1.vtt`, `m3.vtt`, `m5.vtt`, `m7.vtt` (cue texts = the seed transcript lines, re-timed to the clip), `manifest.json`:
  ```json
  { "v": 1, "entries": {
      "placeholder/m1.mp4": { "file": "placeholder-lesson.webm", "type": "video/webm" },
      "placeholder/m1.vtt": { "file": "m1.vtt", "type": "text/vtt" } } }
  ```
  (entries for modules 3, 5 and 7 likewise). WebM avoids any H.264 licensing question.
- Media root: unpackaged `join(app.getAppPath(), 'resources/media')`; packaged `join(process.resourcesPath, 'media')` (Phase 10 adds `extraResources`). The manifest is loaded once at start-up with a zod schema (file names `^[a-z0-9-]+\.(webm|mp4|vtt)$`, types in an allowlist); a bad manifest disables media (logged), never crashes.
- Config: `MAIN_VITE_MEDIA_BASE_URL` (https, default `https://media.example.com/csense/`), `MAIN_VITE_MEDIA_MODE` (only `bundled` accepted in Phase 6). Same validation style as the API URL policy (`config.ts`).

### 5.2 Serving it under the strict CSP
- `registerSchemesAsPrivileged`: add `stream: true` to the `app` scheme.
- `protocol.handle('app')`: requests to `/media/<file>` go to `resolveMediaFile(url, mediaRoot, manifestFiles)` (exact match against manifest values; traversal rules of `resolveAppFile`), everything else to the bundle as today.
- Range: pure `parseByteRange(header, size)` supports one range (`bytes=a-b`, `bytes=a-`, `bytes=-n`); 206 with `Content-Range` and `Content-Length`; 416 with `Content-Range: bytes */size` on unsatisfiable or multi-range input; 200 without a Range header. `Accept-Ranges: bytes`. Reads only the requested slice (`fs.open` + `read`), max 8 MB per response.
- MIME additions: `.webm` `video/webm`, `.mp4` `video/mp4`, `.vtt` `text/vtt; charset=utf-8`.
- CSP (`PRODUCTION_CSP` and `index.html` meta): `media-src 'self'`. Development variant (electron-vite transform): `media-src 'self' app://csense`. The egress filter is unchanged (it already allows `app://csense`).
- `mediaResolver.resolveMediaUrl(url, { baseUrl, manifest })` (pure, main): https only; no credentials, query or fragment; same origin as the base; path starts with the base path; decoded remainder is a manifest key; returns `app://csense/media/<file>` or `null`. Applied by the `learning.getModule` handler to `video.url` and `captionsUrl`.

### 5.3 What "watched" means (D6-5)
- Pure `createWatchTracker()` in the renderer: tracks the furthest contiguous position (a `timeupdate` advances it only if `t <= furthest + 2 s`; seeking back is free; seeking forward does not count). `watched = furthest >= 0.9 * duration`.
- **Finish lesson** for a video module is enabled when `watched`, or when the transcript is opened and its last cue has been visible (`TranscriptPanel` `onReachedEnd`, an IntersectionObserver sentinel), or when the video is unavailable (`src === null` or a load error, which also opens the transcript).
- **Can it be gamed? Yes**, by a modified client calling `learning.completeContent` directly, and the plan says so (ADR 0006, 0019). **Is it server-recorded? Only as `contentCompletedAt`**, as in Phase 3. Nothing of value depends on it: XP comes from passes, first-try correct exercises and the gate (ADR 0009, 0017); unlock comes from a server-graded pass.
- Interactive modules have no media gate: the lesson text is followed by practice.

### 5.4 Interactive steps: what "immediate feedback" means without leaking quiz keys (D6-6)
- **Practice exercises** (N2) give per-item feedback at once: the answer is posted, the server returns `correct`, `correctIndex` and the explanation, the choices lock, focus moves to the `FeedbackPanel`, and the correct option is tagged. Exercises are a separate pool from quiz questions (ADR 0007), so this reveals no quiz key. Only the first answer is recorded (practice XP is first-try only, so re-answering earns nothing).
- **Quizzes and the final assessment** give **no per-question feedback during the attempt**: keys stay in the server-side session snapshot until submission (ADR 0007, Phase 1 D6). Feedback is immediate *on submit*: the result (score, pass/fail, XP, badge) and, one click away, the review from the same `AttemptResultDTO`: right/wrong and the explanation for every question, the correct option only once the assessment is passed (D3-13). A per-question "check" endpoint was rejected: it would hand keys out mid-session and allow answer harvesting by abandoning.
- Revisiting an answered exercise shows the recorded choice and whether it was right; "Show explanation" re-posts the recorded index (the server returns `recorded: false`, no new fact).
- Content is plain text everywhere (lesson body, prompts, artefacts, explanations): rendered as text nodes, paragraphs split on blank lines (D6-18). An ESLint `react/no-danger` rule is added for the renderer.

## 6. Onboarding and preferences (FR4; ADR 0020)
- **When:** after the gate releases, if `session.user.role === 'employee' && onboardingRequired`. Administrators never see it (they keep the Phase 5 admin placeholder).
- **Where "seen" is stored (D6-1):** server, `Employee.onboarding`, set by `me.completeOnboarding` with `completed` ("Start Module 1") or `skipped` ("Skip intro"). Main updates its `SessionView` and emits a `session` event, so the router moves on.
- **Failure:** if the PATCH fails (network), the renderer continues (dashboard or Module 1) and shows a non-blocking toast; onboarding shows again next launch. It never blocks training.
- **Preferences (D6-2):** `app/preferences.ts` reads and writes `localStorage['csense.ui.v1'] = { v: 1, prefs: { theme, motion, textSize } }`, validated on read (unknown or corrupt → defaults). `AppProvider` passes them to `ThemeProvider.initialPreferences` and persists through `onPreferencesChange`. The same controls are reachable later in a **Display settings dialog** from the AppShell gear (`onOpenSettings`). Nothing else is ever stored in renderer storage.
- Onboarding props: `employeeName` from the session, `moduleCount` from the overview (loaded in parallel; fallback text "a few short modules" while loading), `passMarkPercent = DEFAULT_PASSING_SCORE` with the copy "usually", `levels = LEVELS`.

## 7. Renderer: screens, routing and states
### 7.1 Routing (`app/navigation.ts`, pure reducer, no router library)
```ts
type View =
  | { name: 'onboarding' }
  | { name: 'dashboard' } | { name: 'modules' } | { name: 'badges' } | { name: 'final' }
  | { name: 'module'; moduleId: string; stage: 'lesson' | 'practice' | 'quiz' }
  | { name: 'quiz'; target: QuizTarget; returnTo: View };
```
- `AppRouter`: unchanged for boot, login and gate; `released` renders `Workspace`.
- `Workspace` initial view: crash-resume session → `quiz` (as Phase 5); else `onboarding` if required; else `dashboard`.
- Nav ids from `EmployeeDashboardScreen` (`dashboard`, `modules`, `badges`, `final`) map to views. A `navigate` event: `home` → `dashboard` (ignored while lockdown is active, as today); `{ module }` → opened only if the id is in the cached overview and not locked, otherwise `dashboard`.
- Quiz exits: **pass → Continue → `dashboard`** (with the achievement dialog, 7.4); fail or abandoned → Continue → `returnTo` (module, quiz stage) where Retry is offered; `onBackToModule` from the intro → `returnTo`.

### 7.2 Screens and their states
| View | Screen (container) | Data | Loading | Empty | Error / offline | Other |
|---|---|---|---|---|---|---|
| Onboarding | `OnboardingScreen` (`OnboardingContainer`) | session, overview count | n/a (static steps) | n/a | PATCH failure → toast, continue | GateShell, skippable |
| Dashboard | `EmployeeDashboardScreen` (`DashboardContainer`) | A3 + A4 + A5 in parallel | `state='loading'` (Spinner, `aria-busy`) | no modules → EmptyState "No training has been assigned yet. Your security team will add modules." | `state='error'` + retry; `NETWORK_UNAVAILABLE` → "Can't reach CSense. Check your connection and try again." | first-run greeting; final card |
| Modules | **new** `ModulesScreen` (AppShell + `ModuleCard` list) | A3 | Skeleton cards | as dashboard | as dashboard | locked cards show `lockedReason` |
| Badges | **new** `BadgesScreen` (AppShell + `BadgeGrid`) | A5 | Skeleton | "Badges appear here as you complete modules." | as dashboard | earned count |
| Module player | `ModulePlayerScreen` (`ModulePlayerContainer`) | A6 (+A3 for the sidebar), A7 on first open | `state='loading'` | no exercises → stage skipped | `MODULE_LOCKED` → locked view "Pass the Module N quiz to unlock" + back; 404 → "This module is no longer available"; network → ErrorState + retry; exercise post failure → inline Alert, choice not locked; `CONTENT_INCOMPLETE` → Alert naming the unanswered scenarios and jump to the first | video unavailable → transcript mode |
| Quiz (module or final) | `QuizScreen` (`QuizContainer`, extended) | A10/A12 for the intro, A11/A13 | intro button busy | n/a | start errors as Phase 5 (`quizStartErrorMessage`); cooldown → intro shows "You can try again at HH:MM" with Start disabled; `ALREADY_PASSED` → "You have already passed this quiz." | review enabled (7.3) |
| Final entry | **new** `FinalAssessmentScreen` (`FinalAssessmentContainer`) | A12 | Spinner | 404 → "No final assessment is configured yet." | network → ErrorState | locked: remaining modules; available: count, pass mark, attempt no., "Start final assessment" → quiz view; completed: score, date, "Training complete" (no retake) |
| Settings | **new** `DisplaySettingsDialog` | preferences | n/a | n/a | n/a | same controls as onboarding step 4 |

Session expiry (`NOT_SIGNED_IN`, `SESSION_EXPIRED`): main already emits `session: signed_out`; the router goes to Login with "Your session ended". `GATE_LOCKED`: the router already shows the gate; containers ignore it. Restricted: 6.4 relock path. No content is cached for offline use (N5).

### 7.3 Phase 1 components and layouts reused, and the changes
**Reused as is:** layouts `AppShell`, `GateShell`, `LockdownShell`; components `Button`, `Card`, `Alert`, `EmptyState`, `ErrorState`, `Spinner`, `Skeleton`, `ProgressBar`, `ProgressRing`, `XPBar`, `LevelChip`/`LevelCrest`, `LevelLadder`, `AchievementBadge` (+ `badgeMotifs.ts`), `BadgeGrid`, `ModuleCard`, `ModuleList`, `Stepper`, `QuizQuestion`, `QuizOption`, `QuestionNavigator`, `ScoreSummary`, `FeedbackPanel`, `AttemptsIndicator`, `LockdownBanner`, `Dialog`, `ConfirmDialog`, `FocusTrap`, `LiveRegion`, `Toast`, `RadioGroup`, `Switch`, `VisuallyHidden`; screens `OnboardingScreen`, `EmployeeDashboardScreen`, `QuizScreen` (+ `QuizIntro`, `QuizRunner`, `QuizResult`, `QuizReview`).

**Changed (small, prop-additive, fixtures and axe tests updated; ui-ux-designer reviews):**
- `ModulePlayerScreen`: `lessonBody?: string` (rendered by `LessonText`); `state?: 'ready' | 'loading' | 'error' | 'locked' | 'not_found'` with `onRetry`, `lockedReason`; exercises only in the `practice` stage for both formats; primary action `lessonAction: { label, enabled, reason? }` and `onLessonAction` (Continue to practice / Continue to quiz / Finish lesson); `quizSummary?: { passed, bestScore, attempts }` on the quiz stage of a completed module.
- `QuizScreen` intro: `startBlocked?: { reason: string }` (cooldown, already passed); `onReviewAnswers` is now always provided after a submitted attempt.
- `InteractiveExercise`: `pending?: boolean` (choices disabled, `aria-busy`), `correctChoiceId?: string` (QuizOption "Correct answer" tag after feedback).
- `VideoPlayerFrame`: `onError?: () => void` (fires on `<video>` `error`; the container switches to transcript mode).
- `TranscriptPanel`: `onReachedEnd?: () => void` (last-cue sentinel).
- `EmployeeDashboardScreen`: `onOpenSettings` and `onSignOut` wired; the final card gets `cooldownUntil` text; no layout change.

**Genuinely new:**
- `LessonText` (component): plain text to paragraphs; no HTML.
- `AchievementDialog` (component): `Dialog` + `AchievementBadge` + `LevelChip`; variants badge, level-up, training complete (combined in one dialog); motion only when `reducedMotion` is false; announced through the dialog title.
- `DisplaySettingsDialog` (component): theme, reduce motion, text size.
- `ModulesScreen`, `BadgesScreen`, `FinalAssessmentScreen` (screens built only from the components above, with fixtures in the styleguide).
- Containers: `OnboardingContainer`, `DashboardContainer`, `ModulesContainer`, `BadgesContainer`, `ModulePlayerContainer`, `FinalAssessmentContainer`, `AchievementHost`.
- Removed: `screens/TrainingHome/*` and `HomeContainer`.

### 7.4 Module player flow (container state machine)
1. Load A6 and A3. If `progress.startedAt === null` and the module is not completed, call A7 once.
2. **Lesson:** video modules show `VideoPlayerFrame` (captions on by default, transcript toggle), key takeaways and the lesson text; interactive modules show the lesson text and takeaways. Action: "Continue to practice" (exercises exist) or "Continue to quiz" (none); for video modules it is enabled by the watched rule (5.3) with the reason "Watch the video or read the transcript to continue".
3. **Practice:** one exercise at a time ("Scenario n of N"), A8 on answer, feedback at once, "Next scenario"; after the last one, "Continue to quiz".
4. **Continue to quiz:** if `contentCompletedAt` is null, call A9; on success navigate to the `quiz` view with a `QuizTarget` built from `detail.quiz` (title, `questionCount`, `passingScore`, `nextAttemptNumber`, `cooldownUntil`).
5. **Completed modules** stay readable (lesson and practice), and the quiz stage shows "Passed with N %" (no new session; `ALREADY_PASSED`).

### 7.5 Quiz flow, review and achievement moments
- Unchanged Phase 5 lockdown flow (`assessment.startSecure` → questions only while active → submit or exit).
- **Review:** `toQuizReview(result)` maps `AttemptResultDTO.review` to `QuizQuestionData` with `correctOptionId` only when `correctIndex` is present and `explanation` when present. Abandoned and expired attempts have an empty review: the button is hidden. The review is shown **after lockdown exits** (D6-7).
- **Achievements:** `detectAchievements(before: XpSummaryDTO | null, after: XpSummaryDTO, result)` (pure) → `{ badge?, levelUp?: { from, to }, trainingComplete? }`. `before` is the cached A4 value; after a passed attempt the store refetches A4, A5 and A3. `AchievementHost` shows one `AchievementDialog` on return to the dashboard; focus returns to the dashboard heading when it closes. Gate XP (D5-9) can also change the level; that shows on the dashboard without a dialog.
- **Final pass:** `trainingComplete` → "You've completed your training" dialog; the dashboard final card shows "Completed with N %".

### 7.6 Data layer
- `app/data/learningStore.ts`: caches `overview`, `xp`, `badges` with `status: 'idle' | 'loading' | 'ready' | 'error'`; `refresh(keys)`; invalidated after A7, A9, a quiz result, and on `session` change (cleared on sign-out so the next employee sees nothing of the previous one).
- `app/learning/mappers.ts` (pure): `toModuleCardData`, `toModuleListItem`, `lockedReasonText(lockedBy)` ("Pass the Module 3 quiz to unlock"), `toBadgeData` (an `iconMotif` outside `BADGE_ICON_MOTIFS` falls back to a generic motif), `toFinalCard`, `toQuizTarget`, `toQuizReview`.
- `app/messages.ts`: new mappings for `LOCKDOWN_ACTIVE`, `MODULE_LOCKED`, `CONTENT_INCOMPLETE`, `ALREADY_PASSED`, `NOT_FOUND`, `BAD_RESPONSE` ("Something went wrong. Try again.").

## 8. Accessibility (A11Y)
- **Media:** captions on by default for every bundled video; transcript panel; the transcript is also the alternative path to finish a lesson (WCAG 1.2.3); no autoplay; player keyboard shortcuts unchanged. Closes accessibility.md trade-off 8 on the content side: the shared `moduleAuthoringSchema` gains a refine "a video module needs `captionsUrl` and at least one transcript cue" (the seed already complies; Phase 7 authoring inherits it).
- **Keyboard:** every new view reachable from the AppShell nav and skip links; focus moves to the `h1` on view change, to the `FeedbackPanel` after an exercise answer, to the result heading after submit; dialogs trap focus and restore it; the lockdown "Exit quiz" rule (WCAG 2.1.2) is unchanged.
- **Status and announcements:** lock state as icon + text + colour; `LiveRegion` (polite) for "Answer saved", XP earned and exercise pending; `role=alert` only for errors that block.
- **Reduced motion:** `AchievementDialog` and progress animations honour `reducedMotion` (OS or in-app preference); no confetti loops.
- **Text size and zoom:** Large and Larger presets persisted; 200 % zoom at 1280x800 without loss.
- **Gate (automated):** (1) jsdom axe on every new or changed screen fixture and state in `screens.a11y.test.tsx` (dark and light); (2) the styleguide Chromium spec picks the new fixtures up automatically (`hrefs.length` floor raised from 7 to the new count); (3) axe (`@axe-core/playwright`, legacy mode, WCAG 2.0/2.1 A and AA) on the live app inside the journey spec at onboarding, dashboard, module player (video, practice with feedback), quiz intro, result and review, final entry. Zero violations required.
- **Manual (recorded in the PR):** NVDA run gate → login → onboarding → module → quiz → result → dashboard; Windows High Contrast; 200 % zoom.

## 9. Tests
### 9.1 Shared (Vitest)
- ONB1–ONB3: `onboardingRequestSchema` strict (extra field, unknown outcome → fail); `onboardingStateSchema` strict; `ONBOARDING_OUTCOMES` exact.
- AUTH-V1: `moduleAuthoringSchema` refuses a video module without `captionsUrl` or transcript cues; the seed passes.

### 9.2 Server (supertest + mongodb-memory-server)
- `onboarding.test.ts`:
  - ON1 employee PATCH `completed` → 200 `{ outcome, at }` (injected clock); `/auth/me` then shows it.
  - ON2 second PATCH (`skipped`) → 200 with the **first** state (first write wins).
  - ON3 ten concurrent PATCHes → one stored state, all 200 with it.
  - ON4 body with extra fields, `{ outcome: 'done' }`, `{ onboarding: null }` → 400; nothing stored.
  - ON5 administrator token → 403; no token → 401; restricted employee → 403 `ACCESS_RESTRICTED`.
  - ON6 login response and `POST /admin/users` response carry `onboarding: null` for a new employee; the strict `EmployeeDTO` shape is updated in the user tests.
  - ON7 onboarding does not change `totalXP`, the risk profile, or create audit entries.
- `xp.farming.test.ts` (if not already covered by Phase 4): XF1 re-answering every exercise 20 times, repeating content-complete and start, and an onboarding PATCH leave `/me/xp` unchanged; XF2 a passed module's XP is credited once across retries.
- Updates: `rbac.denyByDefault` B1 inventory 36 → 37 (reviewed snapshot); GT7 restricted sweep includes the new route automatically; e2e harness unit test (new account, keys complete and unique).

### 9.3 Desktop main (Vitest node project `desktop-main`)
- OPS1–OPS4 operations: the eight new entries (paths encoded, ObjectIds validated, PATCH sends a JSON body, success statuses); a response with an extra `correctAnswer` or `explanation` field → `BAD_RESPONSE` (module detail, quiz overview, XP).
- IPC9 inventory snapshot: exactly 22 channels + 1 event; `me` area present.
- POL1–POL5 channel policy: every channel has a policy (missing → start-up throws); `learning.*`/`me.*` return `GATE_LOCKED` before release and `LOCKDOWN_ACTIVE` while lockdown is active (table-driven over all channels); `assessment.*` unaffected; rate ceilings per channel (6th exercise answer in one second refused).
- H1–H4 handlers: `ACCESS_RESTRICTED` from a journey call triggers `gate.noteRestricted()`; `me.completeOnboarding` success updates `SessionView.user.onboardingRequired` and emits a `session` event; `getModule` maps media through the resolver; no handler returns a raw content URL.
- MR1–MR8 `resolveMediaUrl`: manifest hit → `app://csense/media/<file>`; http, other origin, base-path escape (`..`, `%2e%2e`, encoded slash), credentials, query, fragment, unknown key → `null`.
- RG1–RG8 `parseByteRange` and the media route: no header → 200 full; `bytes=0-99` → 206; open-ended and suffix ranges; out of range and multi-range → 416; file outside the manifest → 404; traversal → 404; HEAD; MIME per manifest.
- MF1–MF3 manifest loader: valid; invalid file name or type → media disabled and logged; missing file → entry dropped.
- CFG9–CFG10 media config: non-https base refused; `MAIN_VITE_MEDIA_MODE=remote` refused in Phase 6.
- CSP1: `PRODUCTION_CSP` contains `media-src 'self'` and no remote host; dev variant adds only `app://csense`.

### 9.4 Renderer (Vitest jsdom + Testing Library + axe)
- NAV1–NAV8 `navigation.ts`: initial view rules (resume, onboarding, dashboard); nav ids; `navigate` deep link to a locked or unknown module → dashboard; quiz pass → dashboard, fail → returnTo.
- WT1–WT6 watch tracker: contiguous play reaches 90 %; a forward seek does not count; seek back then replay counts; tolerance; zero or NaN duration; reset per module.
- MAP1–MAP8 mappers: lock reasons, positions, badge motif fallback, final card states, review mapping (no `correctOptionId` without `correctIndex`), quiz target with cooldown.
- ACH1–ACH4 `detectAchievements`: badge only; level-up; both; final → training complete; no `before` → no level-up claim.
- PREF1–PREF4 preferences: round trip; corrupt JSON, wrong version, unknown values → defaults; only `prefs` written (no other key).
- Containers: Onboarding (complete → PATCH `completed` then Module 1; skip → `skipped` then dashboard; PATCH failure → toast and continue); Dashboard (loading, error + retry, empty, ready mapping, sign-out clears the store); Module player (video without exercises, video with exercises, interactive; watched gating and transcript path; video error → transcript; exercise pending/error/feedback/revisit; `CONTENT_INCOMPLETE`; `MODULE_LOCKED`; completed module); Final entry (locked, cooldown, available, completed, 404); Quiz (review shown after a submitted attempt, hidden after abandon).
- TXT1: lesson text, prompts and explanations containing `<img onerror>` render as literal text.
- Axe on all new and changed screen states and components (dark and light).

### 9.5 E2E (Playwright Electron, windows-latest)
**Harness changes (`server/src/testing/e2eServer.ts`, backend track):**
- New employee `journey@e2e.example.com` (name "Jordan Journey"): no progress, `onboarding: null`.
- Existing `gate-pass@`, `gate-fail@`, `quiz@` get `onboarding: { outcome: 'completed' }` preset so the Phase 5 specs stay focused.
- Ready line gains `quizKey: Record<questionText, number>` over every quiz pool question and the final-test pool, and `exerciseKey: Record<prompt, number>`. The harness throws if any text is duplicated across pools (key collisions would make the spec ambiguous). Options are served in stored order (identity shuffle), as today.

**`e2e/journey.spec.ts`** (`test.describe.serial`; fresh `CSENSE_USER_DATA_DIR`; each test under the 90 s default except where `test.setTimeout(150_000)` is set; helpers in `e2e/support/journey.ts`: `passGate`, `completeModule`, `answerQuiz(page, key, { wrong?: number })`, `readDashboard`, `axeCheck`):
1. **First login and onboarding.** Sign in as `journey@`; gate: answer correctly, "Continue now". Onboarding heading "Welcome to CSense, Jordan"; step through; choose Light (assert `html[data-theme=light]`); "Start Module 1". Assert by HTTP (`loginHttp` + `GET /auth/me`) `onboarding.outcome === 'completed'`. Axe on onboarding.
2. **Module 1 (video, no exercises), the full video path.** "Module 1 of 7"; the `<video>` `src` starts with `app://csense/media/`; a captions `<track>` is present; "Continue to quiz" is soft-disabled with its reason; play to the end; the button enables. Quiz: intro shows the module's pass mark; Start secure quiz (lockdown active, as Phase 5 asserts); answer all by `quizKey`; submit → "Passed", XP earned and badge "First Steps" shown; record `xpEarned`. Continue → achievement dialog (badge + level-up to Aware, since gate 10 + module XP crosses 300) → close → dashboard. Axe on module player, quiz intro and result.
3. **Module 2 (interactive), failure, review and retry.** Locked module 3 card cannot be opened (reason visible). Open module 2: lesson text → practice; answer scenario 1 wrongly → "Not quite", explanation visible, correct option tagged, focus on the feedback; the rest correctly. Continue to quiz; answer with two wrong → "Not passed"; Review answers: explanations shown, **no** "Correct answer" tag (reveal policy); Retry quiz → all correct → passed; Continue → dashboard. Axe on practice feedback and review.
4. **Modules 3 to 5** via `completeModule` (video modules use the **transcript path**: open the transcript, scroll to the end, "Finish lesson" enables; this covers the accessible alternative and keeps runtime low). After each: sidebar shows the next module unlocked, badge count +1.
5. **Modules 6 and 7**, same helper.
6. **Dashboard reflects real data.** "7 of 7 complete"; badges "7 of 7"; XP shown = `10 (gate) + Σ xpEarned` recorded from the result screens **and** = `GET /me/xp.totalXP` over HTTP; level chip = HTTP `level` and = `levelForXp(totalXP)` from `@csense/shared`; "Up next" says all modules complete; final card enabled. Axe on the dashboard.
7. **Final assessment.** Nav "Final assessment" → entry: question count and pass mark from the API; Start → 15 questions with the navigator under lockdown; answer by key; submit → passed, XP shown; Continue → "training complete" dialog → dashboard final card "Completed with 100%"; XP and level re-checked against HTTP. Axe on the final entry.
8. **Relaunch.** Same user data: session resumes, gate auto-continues within the clearance, **no onboarding**, dashboard values unchanged, Light theme persisted.

Runtime budget: about 3 to 4 minutes (one 8 s clip played once, 8 lockdown cycles of a few seconds, 17 exercises). Whole e2e job stays well inside 30 minutes.

**Updates to Phase 5 specs:** `gate.spec` step 8 and 9 expect the dashboard heading instead of "Your training"; `lockdown.spec` reaches the quiz through dashboard → module 1 → "Continue to quiz" (shared helper `openModuleQuiz`); `smoke.spec` bridge keys gain `me` and the nested method lists; `security.spec` adds: (a) during an active quiz lockdown every `learning.*` and `me.*` bridge method returns `LOCKDOWN_ACTIVE`; (b) after the journey steps used in the spec, `localStorage` holds only `csense.ui.v1` with `prefs`; (c) a deep scan of every bridge result collected during a short module + quiz pass finds no `correctAnswer`, no `explanation` before an answer, and no `http(s)://` media URL.

## 10. Security properties the security-tester should try to break
1. **E1 IDOR on progress.** No channel or route takes a user id. Another employee's `moduleId`/`exerciseId`/`sessionId`/`attemptId` returns 403/404 and never data. The renderer cannot address another user.
2. **E2 Unlock bypass from the renderer.** Calling `learning.getModule`, `startModule`, `answerExercise`, `completeContent` or `assessment.startSecure` for a locked module returns `MODULE_LOCKED` from the server; main holds no unlock state; a crafted `navigate {module}` event cannot open a locked module.
3. **E3 Replaying completions.** `completeContent` keeps the first timestamp; exercise answers record the first only; quiz submits are single-use (409); `PATCH /me/onboarding` is first-write-wins. Replays never change XP, badges or progress beyond the first.
4. **E4 XP farming.** Repeated views, starts, exercise re-answers, content completes, onboarding writes, quiz retries after a pass (refused) and gate reruns within a clearance leave XP unchanged (XF1, XF2, Phase 5 XPG).
5. **E5 Leaking answers to the renderer.** No quiz or final key or explanation before submission; exercise `correctIndex` only after that exercise is answered; review per D3-13; main parses every response strictly (`BAD_RESPONSE` on extra fields).
6. **E6 Closed book.** While lockdown is active, every `learning.*` and `me.*` channel returns `LOCKDOWN_ACTIVE`; questions never coexist with module content in the renderer.
7. **E7 Bridge surface growth.** Exactly 22 invoke channels + 1 event (snapshot); strict input schemas, ObjectId-only ids, no URL or path parameter, no generic call; per-channel rate ceilings; sender checks unchanged.
8. **E8 Media.** The renderer never receives a non-`app://csense/media/` URL; the protocol serves only manifest files (traversal, encoded separators, unknown names → 404); malformed `Range` headers never crash main or read outside the file; no new egress host; `media-src` has no remote origin.
9. **E9 Renderer storage.** `localStorage` holds only display preferences; tampering with it changes only the local theme.
10. **E10 Content injection.** Authored text (lesson body, prompts, artefacts, explanations, badge and module names) never renders as HTML (`react/no-danger`, TXT1).
11. **E11 Restriction mid-session.** An `ACCESS_RESTRICTED` response to any journey call re-locks the workstation into the restricted state.
12. **E12 Sign-out on a shared workstation.** Sign-out clears the renderer store and caches; the next employee sees no previous data (preferences excepted, by design).
13. **E13 Watched rule.** Confirm and document that a modified client can finish a lesson without watching, and that this yields no XP, unlock or pass (accepted, ADR 0019).

## 11. Environment and configuration
**Desktop `.env.example` (desktop section):**
- `MAIN_VITE_MEDIA_BASE_URL=https://media.example.com/csense/` (https only; the prefix that content URLs must start with)
- `MAIN_VITE_MEDIA_MODE=bundled` (only value accepted until Phase 10)

**Server:** no new keys. **Dependencies:** none new (`@axe-core/playwright` is already a dev dependency). `npm audit --audit-level=high` must stay clean.

## 12. Files to create or change
### 12.1 Shared (`shared/src/`)
- New: `constants/onboarding.ts`; `schemas/onboarding.ts` (request); `schemas/onboardingResponses.ts` (state); `schemas/onboarding.schemas.test.ts`.
- Change: `types/user.ts` (`EmployeeDTO.onboarding`); `schemas/learningAuthoring.ts` (captions refine) and its test; `index.ts` exports.

### 12.2 Server (`server/src/`)
- New: `features/onboarding/onboarding.routes.ts`, `onboarding.service.ts`.
- Change: `models/User.ts` (Employee `onboarding`); `features/users/user.mapper.ts`; `routes.ts`; `testing/e2eServer.ts` (journey account, presets, `quizKey`, `exerciseKey`, uniqueness check).
- Tests: `test/onboarding.test.ts`, `test/xp.farming.test.ts` (if needed), B1 inventory snapshot, user/auth DTO expectations, harness unit test.

### 12.3 Desktop
- Main: `api/operations.ts`, `api/client.ts` (PATCH), `ipc/handlers.ts`, `ipc/registry.ts` (per-channel rate), new `ipc/policy.ts`, new `media/mediaResolver.ts`, new `media/manifest.ts`, new `security/range.ts`, `security/protocol.ts`, `security/policy.ts` (CSP), `config.ts`, `session/sessionService.ts` (onboarding view, update after PATCH), `gate/gateController.ts` (public `noteRestricted()`), `bootstrap.ts` (media root, manifest load); tests per 9.3.
- Shared/preload: `shared/ipcChannels.ts`, `shared/ipc.ts`, `shared/dto.ts`, `preload/index.ts` (`me` area), `preload/bridge.d.ts`.
- Build: `src/renderer/index.html` (CSP), `electron.vite.config.mts` (dev CSP media-src), `desktop/resources/media/{placeholder-lesson.webm, m1.vtt, m3.vtt, m5.vtt, m7.vtt, manifest.json, README.md}`; `.gitattributes` marks `*.webm` binary.
- Renderer new: `app/navigation.ts`, `app/preferences.ts`, `app/data/learningStore.ts`, `app/learning/{mappers,watchProgress,achievements}.ts`, `app/containers/{Onboarding,Dashboard,Modules,Badges,ModulePlayer,FinalAssessment}Container.tsx`, `app/AchievementHost.tsx`, `components/{LessonText,AchievementDialog,DisplaySettingsDialog}/*`, `screens/{Modules,Badges,FinalAssessment}/*` (types, fixtures, screen, index), styleguide registrations, tests per 9.4.
- Renderer changed: `app/Workspace.tsx`, `app/AppProvider.tsx` (preferences), `app/store.ts` (clear on sign-out hook), `app/messages.ts`, `app/containers/QuizContainer.tsx` (review, cooldown, returnTo, final target), `screens/ModulePlayer/*`, `screens/Quiz/*` (intro `startBlocked`), `components/{InteractiveExercise,VideoPlayerFrame,TranscriptPanel}/*`, `screens/screens.a11y.test.tsx`; ESLint `react/no-danger` for the renderer.
- Renderer removed: `screens/TrainingHome/*`, `app/containers/HomeContainer.tsx`.
- E2E: new `e2e/journey.spec.ts`, `e2e/support/journey.ts`; changed `e2e/support/backendProcess.ts` (types), `gate.spec.ts`, `lockdown.spec.ts`, `smoke.spec.ts`, `security.spec.ts`, `styleguide.a11y.spec.ts` (fixture floor).

### 12.4 Docs
- `docs/api/contract.md`: `PATCH /me/onboarding` (implemented, 37 routes); remove `/me/dashboard`, `/me/progress`; `EmployeeDTO.onboarding`; bridge note.
- `docs/architecture/data-model.md`: `Employee.onboarding`; remove it from "planned additions".
- `docs/design/screens.md`: Phase 6 additions (module player states and actions, review enabled, final entry, Modules and Badges pages, settings dialog, achievement dialog).
- `docs/design/accessibility.md`: trade-off 8 closed (content refine + bundled captions); new journey axe check in the enforcement table.
- `docs/design/components.md`: new components.
- ADR 0013: follow-up pointer to ADR 0019/0020; ADR 0006: pointer to the watched rule in ADR 0019; README: media pack and running the journey spec.

## 13. Implementation sequence (two tracks; the contract freezes first)
**Step 0, together (about half a day): freeze the contract.**
- Shared onboarding schemas and `EmployeeDTO.onboarding`; `contract.md` rows.
- `IPC_CHANNELS_V1`, `IPC_INPUT_SCHEMAS` additions, `ModuleDetailView`, `SessionUserView.onboardingRequired`, `LOCKDOWN_ACTIVE`, `IPC_CHANNEL_POLICY` shape; operation ids and signatures.
- Harness ready-line shape (`journey` account, `quizKey`, `exerciseKey`).
Changes after the freeze need both engineers.

**Backend track (backend-engineer):**
1. B-1 Employee `onboarding` field, mapper, `PATCH /me/onboarding`, ON1–ON7, B1 inventory.
2. B-2 Captions refine in `moduleAuthoringSchema` + test; XF1–XF2 if absent.
3. B-3 Harness: journey account, presets, keys, uniqueness check, harness unit test. **Hand-off:** running harness matching the frozen ready line.
4. B-4 `contract.md`, `data-model.md`.

**Frontend track (frontend-engineer; ui-ux-designer reviews 7.3 changes):**
1. F-1 Main: operations (+PATCH), channel policy and per-channel rate, handlers (`journeyCall`, restriction relock, onboarding session update), preload, inventory snapshot; OPS, IPC9, POL, H tests.
2. F-2 Media: pack and README, manifest loader, resolver, Range route, scheme privilege, CSP; MR, RG, MF, CFG, CSP tests. Verify early on Windows that the clip plays and seeks under `app://` (risk 1).
3. F-3 Renderer data layer: navigation, preferences, store, mappers, watch tracker, achievements; NAV, WT, MAP, ACH, PREF tests.
4. F-4 Screen and component changes and new components with fixtures and axe (7.3); styleguide entries.
5. F-5 Containers: onboarding, dashboard, modules, badges, module player, quiz review/cooldown, final entry, settings, achievement host; container tests; remove TrainingHome.
6. F-6 Update Phase 5 specs (gate, lockdown, smoke, security) against the harness presets.
7. F-7 `journey.spec.ts` + support helpers + live axe checks (needs B-3).

**Together:** J-1 ADR 0019/0020 status flip and doc updates; J-2 `/verify` + manual NVDA, High Contrast and zoom checks on Windows; J-3 security-tester review against section 10; J-4 PR (flags D6 deviations).

Parallelism: B-1..B-2 and F-1..F-6 run after Step 0; only F-7 waits for B-3.

## 14. Risks
1. **Custom-protocol media playback** (`stream` privilege, Range responses, VP9 decode on a GPU-less Windows runner). Mitigation: verify in F-2 first; tiny clip; the journey plays one clip only and uses the transcript path elsewhere; fallback is a 200 full-body response for files under 1 MB (Chromium can seek within a fully buffered small file).
2. **Phase 5 spec churn.** Replacing TrainingHome and adding onboarding breaks `gate.spec` and `lockdown.spec` until F-6. Mitigation: harness presets and a shared navigation helper; run all specs in F-6 before F-7.
3. **"Immediate quiz feedback" expectations** (playbook build prompt) versus server grading. Mitigation: D6-6 explicit with the product owner; per-exercise feedback plus instant result and review.
4. **Review outside lockdown** shows served question text (copyable after the attempt). Accepted with D3-13; the pool (20+ per quiz, unseen-first selection) limits harvesting.
5. **Journey runtime and flakiness** on Windows CI (lockdown cycles, polling). Mitigation: serial tests with explicit timeouts, waits on roles not times, CI retry 1, total about 4 minutes.
6. **EmployeeDTO change** ripples into user, auth and admin tests and into desktop `userResponseSchema` (non-strict, so old clients are unaffected).
7. **Live axe in the production build** (CSP, legacy mode). Mitigation: verify in F-7 early; if blocked, run the same checks on the styleguide fixtures and record why.
8. **Rate budget behind NAT** (D5-24): a dashboard load is three requests. Mitigation: renderer cache, refresh only on mount and after mutations; the per-channel ceilings stop runaway loops.
9. **Placeholder media mistaken for production readiness.** Production video needs Phase 10 remote mode; the PR and ADR 0019 say so.
10. **Content quality and accessibility of real videos** (audio description, WCAG 1.2.5) is a content obligation for Phase 7 authors; the transcript covers 1.2.3 now.
11. **localStorage on shared Windows profiles** shares display preferences between employees. Low impact; documented.
12. **Watched rule bypass** by a modified client. Accepted; no value attached (E13).

## 15. Requirement traceability of planned items
| Item | Requirement |
|---|---|
| Onboarding container, `PATCH /me/onboarding`, `Employee.onboarding` | FR4 |
| Dashboard (overview + XP + badges), Modules and Badges pages | UC-D, G1, G2, N1 |
| Module player: video with captions/transcript, lesson text, practice with immediate feedback | N2, A11Y, UC View Learning Content |
| Content completion before the quiz | N1 (D3-7) |
| Quiz flow under lockdown, result, review, retry | N3, R4 |
| Final assessment entry, result, training complete | N4, UC-F |
| Achievement dialog (badge, level-up) | G1, G2 (UC Award Badge) |
| Per-quiz pass mark from DTO, data-driven module count | N5 |
| Bridge additions, policy table, strict responses | R7 (ADR 0013/0014) |
| No risk anywhere in the employee UI | D17 |
| Bundled media + resolver + Range + CSP | N2, A11Y (captions), NFR CDN media (deferred, seam) |
| Journey e2e + live axe | G, A11Y |

## 16. Not requirement-backed (flagged for approval)
- `DisplaySettingsDialog` (derived from Phase 1 onboarding copy "change these later in Settings" and the AppShell gear).
- Display preferences persistence in renderer `localStorage`.
- `AchievementDialog` as a dialog (the requirement is the badge and level; the "moment" is UX).
- Dedicated Modules and Badges pages (derived from the Phase 1 dashboard nav ids).
- The closed-book rule (`LOCKDOWN_ACTIVE`; derived from R4 anti-cheating).
- Per-channel IPC rate ceilings (derived from D5-24 NAT budget).
- Media manifest allowlist and URL rewriting (derived from the Phase 5 egress model).
- The watched rule's 90 % contiguous threshold and the transcript alternative (D3-7 left "lesson complete" to the client).
- `onboarding.outcome` (distinguishing skipped from completed; FR4 only needs "seen").
- The captions refine in the authoring schema (derived from WCAG 1.2.2 and the accessibility.md follow-up).
- Removal of the reserved `/me/dashboard` and `/me/progress` contract rows.

## 17. Decisions needed (recommended default in bold)
> **Status (2026-11-10): all twenty approved as recommended.** The four product-owner items were
> checked against `docs/CSense_Client_Needs.docx`. FR4 asks only for "a guided onboarding / welcome
> experience for first-time employees" (no policy acknowledgement), so D6-1 holds. The needs doc places
> "immediate right/wrong feedback and short explanations" on module content and interactive exercises,
> and for quizzes asks to "review answers and retry on failure", so D6-6 matches it. Nothing requires
> videos to be watched in full (D6-5). Real videos and captions remain a product-owner content
> deliverable (D6-4). Any of these can be revisited in review.
**Need the product owner:**
1. **D6-1 Onboarding "seen" storage.** **Server flag `Employee.onboarding` via `PATCH /me/onboarding` (the reserved FR4 route); skip and complete both count as seen; first write wins; shown after the gate, employees only.** Alternative: a local per-workstation flag (no server change; onboarding reappears on every new workstation). Product decides whether a skipped intro should ever be offered again (default: no).
2. **D6-4 Video source until Phase 10.** **A bundled placeholder pack (one in-house 8 s clip + captions) served at `app://csense/media/` through a manifest allowlist; unknown URLs show "Video unavailable" with the transcript; remote CDN mode in Phase 10.** Product confirms that demos before Phase 10 show placeholder video, and owns supplying real videos with captions.
3. **D6-5 What "watched" means.** **Finish lesson enables at 90 % contiguous playback, or after reading the transcript to its end, or when the video cannot play; client-side only, not recorded, no XP attached.** Alternatives: video end only (no transcript path: weaker accessibility), or no gating at all.
4. **D6-6 Quiz feedback timing.** **No per-question feedback during quizzes (keys stay server-side until submission); immediate per-item feedback in practice exercises; result and review immediately after submit.** The playbook build prompt says "immediate quiz feedback"; this reading keeps server grading and ADR 0007 intact. Alternative: per-question check (needs a session-model change and leaks keys mid-attempt; not recommended).

**Can be approved as recommended:**
5. **D6-2 Display preferences.** **Renderer `localStorage` (`csense.ui.v1`, prefs only, validated), per Windows profile.** Alternative: a main-side file via two more channels.
6. **D6-3 Dashboard aggregation.** **Compose `GET /modules` + `/me/xp` + `/me/badges`; drop `/me/dashboard` and `/me/progress` from the contract.**
7. **D6-7 Review placement.** **Review after lockdown exits, per the D3-13 reveal policy.** Alternative: review inside lockdown.
8. **D6-8 Closed book.** **Main refuses `learning.*` and `me.*` during lockdown (`LOCKDOWN_ACTIVE`); no server-side check.** Alternative: server 409 while an assessment session is open (can lock content for up to the session TTL after an undelivered abandon).
9. **D6-9 Bridge version.** **Stay `bridgeVersion: 1`; additive (22 channels, new `me` area); snapshot updated.**
10. **D6-10 Per-channel rates.** **Exercise answers 5/s, start and complete 2/s, onboarding 1/s, others 20/s.**
11. **D6-11 After a quiz.** **Pass → Continue → dashboard with one achievement dialog (badge, level-up, training complete); fail → back to the module's quiz stage with Retry; reduced motion disables animation.**
12. **D6-12 Extra surfaces.** **Modules page, Badges page and a Display settings dialog, built only from Phase 1 components.**
13. **D6-13 Attempt history.** **Not in Phase 6** (`/me/attempts` unused; the in-flow review satisfies N3).
14. **D6-14 Exercise revisit.** **Show the recorded choice and correctness; "Show explanation" re-posts the recorded answer (not recorded again).**
15. **D6-15 Final assessment after a pass.** **Score and date shown, no retake (`ALREADY_PASSED`), no final badge (D4-4), "training complete" moment.**
16. **D6-16 Phase 5 specs.** **Harness presets onboarding for existing accounts; TrainingHome removed; specs navigate dashboard → module → quiz.**
17. **D6-17 Dev CSP.** **Development adds `app://csense` to `media-src`; production stays `'self'`.**
18. **D6-18 Lesson text.** **Plain text paragraphs; no Markdown in Phase 6.** Alternative: a safe Markdown subset (new dependency and sanitiser review).
19. **D6-19 Restriction mid-session.** **Any `ACCESS_RESTRICTED` from a journey call re-locks the gate.**
20. **D6-20 Captions in authoring.** **`moduleAuthoringSchema` requires `captionsUrl` and transcript cues for video modules.**

## 18. Requirements I could not trace
- Resolved after drafting: the Client Needs doc was read (see the status note in section 17). FR4 is a
  one-time welcome; immediate feedback applies to module content and exercises; quizzes need review
  and retry; watching in full is not required.
- The CDN-media NFR (ADR 0001) is not met in Phase 6 by design (Phase 10).

## 19. Phase 6 acceptance checklist
**Setup**
- [ ] Branch `phase-06-employee-experience` from `main`; Conventional Commits; no direct commits to `main`.
- [ ] D6-1 to D6-20 answered (D6-1, D6-4, D6-5, D6-6 by the product owner); ADR 0019 and 0020 Accepted (or amended); ADR 0006 and 0013 carry pointers.
- [ ] No new runtime dependency; `npm audit --audit-level=high` clean.

**Shared and server**
- [ ] Onboarding schemas strict (ONB1–ONB3); captions refine (AUTH-V1); the seed still validates.
- [ ] `PATCH /me/onboarding` per 4.2; ON1–ON7 green; B1 inventory 37 reviewed; restricted sweep covers it.
- [ ] Repeated views, answers, completions and onboarding writes do not change XP (XF1–XF2).
- [ ] Harness: `journey@` account, presets, `quizKey` and `exerciseKey`, uniqueness enforced.

**Desktop main**
- [ ] Exactly 22 invoke channels + 1 event (snapshot); every channel has a strict schema and a policy row; unknown policy fails start-up.
- [ ] `learning.*`/`me.*` refused before release (`GATE_LOCKED`) and during lockdown (`LOCKDOWN_ACTIVE`); per-channel rate ceilings enforced (POL1–POL5).
- [ ] Eight new operations, PATCH supported, strict responses (`BAD_RESPONSE` on leaked fields) (OPS1–OPS4).
- [ ] Media: resolver (MR1–MR8), Range route and manifest allowlist (RG1–RG8, MF1–MF3), `stream` privilege, `media-src 'self'` only (CSP1); the renderer never receives a remote media URL.
- [ ] `ACCESS_RESTRICTED` from a journey call re-locks; onboarding completion updates the session view (H1–H4).

**Renderer**
- [ ] TrainingHome removed; Workspace routes onboarding, dashboard, modules, badges, module player, quiz, final, settings (NAV1–NAV8).
- [ ] Every view has loading, empty, error and offline states per 7.2; sign-out clears cached data.
- [ ] Module player: video with captions and transcript, watched rule (WT1–WT6) and transcript alternative, practice with immediate feedback, content completion, completed-module view.
- [ ] Quiz: cooldown and already-passed intros, review per the reveal policy, achievement dialog (ACH1–ACH4); final entry states.
- [ ] Preferences persist and validate (PREF1–PREF4); authored text never renders as HTML (TXT1, `react/no-danger`).
- [ ] Axe clean on all new and changed fixtures in dark and light (jsdom and Chromium styleguide).

**E2E (windows-latest)**
- [ ] `journey.spec.ts` green: first login → gate → onboarding → modules 1–7 (one failed attempt with review and retry) → dashboard XP equals the API and the sum of earned XP, level matches `levelForXp`, badges 7 of 7 → final assessment passed → relaunch without onboarding; live axe checks clean.
- [ ] `gate.spec`, `gate.restricted.spec`, `lockdown.spec`, `security.spec` (closed book, storage, leak scan) and `smoke.spec` (bridge keys with `me`) green.
- [ ] E2E job within the 30-minute CI limit.

**Docs and Definition of Done**
- [ ] `contract.md`, `data-model.md`, `screens.md`, `components.md`, `accessibility.md`, `.env.example` (media keys), README (media pack, journey spec) updated.
- [ ] `npm run lint`, `typecheck`, `test` (shared, server, renderer, desktop-main), `build`, `format:check`, `test:e2e`, `test:a11y` pass; CI green on Windows and Ubuntu; Phase 0–5 suites still green.
- [ ] Manual NVDA, High Contrast and 200 % zoom checks recorded in the PR.
- [ ] Security-tester review against section 10 (E1–E13) has no open High or Critical finding; `/verify` passes.
