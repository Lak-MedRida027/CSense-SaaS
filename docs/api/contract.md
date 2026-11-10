# CSense REST API contract (v1)

Base path: `/api/v1`. Source: `docs/CSense_UseCase_UML.png` and the Client Needs FRs.

**Implemented:** Phase 0 `GET /health` and `GET /health/ready`; Phase 2 the four Authenticate
routes (`/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`), `POST /admin/users` and
`GET /config/features`; Phase 3 the 15 learning-engine routes below (all employee-only); Phase 4 the
8 routes for XP, badges, risk profiles, escalations and the audit log; Phase 5 the 5 gate routes below. These 36 are the whole route inventory (snapshot-tested in `server/test/rbac.denyByDefault.test.ts`). Every other route below is a contract. No stubs are registered, so unimplemented routes return 404 (deny by default).

## Auth levels
| Level | Meaning |
|---|---|
| public | No token |
| refresh | No access token; a valid refresh token in the JSON body (ADR 0004) |
| auth | Any valid access token |
| employee | Role `employee` |
| admin | Role `administrator` |
| self | Employee acting on their own data. Lives under `/me`; identity comes from the token only, never from an id parameter |

Anything not listed returns 404. Routes behind a disabled feature flag also return 404.
There is **no self-registration**: `POST /auth/register` must return 404 (tested).
Every route is declared in the server's route registry with one of these levels; the central access
gate rejects anything not in the registry (ADR 0005). Role matching is exact: an administrator does
not inherit `employee` routes.

## Authentication (Phase 2, ADR 0004)
- Access token: JWT (HS256), sent as `Authorization: Bearer <token>`, lifetime 15 min. Claims:
  `sub`, `role`, `sid`, `iss`, `aud`, `iat`, `exp`, `jti` only.
- Refresh token: opaque string, returned and accepted **in the JSON body** (never a cookie),
  rotated on every use, absolute lifetime 7 days from login. Reusing a rotated refresh token revokes
  the whole session. Only the Electron main process handles it (Phase 5).
- Every auth response carries `Cache-Control: no-store`. A deactivated account, a logged-out
  session or a revoked session makes its access tokens fail with 401 on the next request.

Token response (login adds `user`):
```json
{
  "tokenType": "Bearer",
  "accessToken": "<jwt>",
  "accessTokenExpiresIn": 900,
  "refreshToken": "<opaque>",
  "refreshTokenExpiresAt": "2026-11-13T09:00:00.000Z",
  "user": { "id": "...", "name": "...", "email": "...", "role": "employee", "isActive": true, "createdBy": "...", "createdAt": "...", "totalXP": 0, "level": "Apprentice" }
}
```

## Error envelope
```json
{ "error": { "code": "NOT_FOUND", "message": "Resource not found", "details": {} } }
```
`details` is only used by `VALIDATION_ERROR` (`{ issues: [{ location, path, message }] }`, never the
submitted value). Authentication failures use one generic message per endpoint to prevent account
enumeration. Stack traces and internal messages are never returned.

| Code | Status | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | body, params or query fail the zod schema (including unknown fields) |
| `INVALID_JSON` | 400 | malformed JSON body |
| `BAD_REQUEST` | 400 | other client errors from the body parser |
| `INVALID_CREDENTIALS` | 401 | login failed, for any reason (unknown email, wrong password, deactivated) |
| `UNAUTHENTICATED` | 401 | access token missing, malformed, invalid, expired, or its user/session is no longer valid. Sent with `WWW-Authenticate: Bearer` |
| `INVALID_REFRESH_TOKEN` | 401 | refresh token unknown, expired, revoked, reused, or its user is deactivated |
| `FORBIDDEN` | 403 | authenticated but wrong role |
| `NOT_FOUND` | 404 | route or resource does not exist (or is not in the registry) |
| `MODULE_LOCKED` | 403 | module (or its quiz/exercises) is beyond the employee's frontier |
| `FINAL_TEST_LOCKED` | 403 | final test started or submitted before every module is passed |
| `CONTENT_INCOMPLETE` | 409 | quiz session before content completion; content complete before all exercises are answered |
| `ALREADY_PASSED` | 409 | new session for an assessment already passed |
| `SESSION_CLOSED` | 409 | submit or abandon on a session already submitted, abandoned or expired (replay, race loser) |
| `SESSION_EXPIRED` | 409 | submission after the session time limit; an `expired` attempt is recorded |
| `RATE_LIMITED` (session routes) | 429 | more than `SESSION_START_RATE_MAX` quiz or final-test session starts per employee per window; `Retry-After` set |
| `ACCESS_RESTRICTED` | 403 | employee route while the latest gate run is restricted and not restored (allowed: `/auth/me`, `/config/features`, `/gate/status`, `/gate/challenge`) |
| `GATE_CHALLENGE_STALE` | 409 | `POST /gate/attempts` for a challenge that is not the run's current one (replay, race loser, closed run, another employee's id). Nothing is consumed |
| `GATE_UNAVAILABLE` | 503 | fewer active gate questions than `GATE_MAX_ATTEMPTS`; the desktop treats it like offline (D5-12) |
| `NOT_RESTRICTED` | 409 | restore-access for an employee with no unrestored restricted run |
| `ESCALATION_NOT_ACKNOWLEDGED` | 409 | restore-access while the run's escalation is still `open` (`GATE_RESTORE_REQUIRES_ACK`) |
| `ASSESSMENT_COOLDOWN` | 409 | `ASSESSMENT_COOLDOWN_AFTER_FAILS` consecutive failed attempts at this quiz or final test; sent with `Retry-After` (seconds) and `details: { retryAt }` (ISO time). A pass resets the streak |
| `CONFLICT` | 409 | unique constraint (email in use), a concurrent quiz-session start that lost the race, or a stale `expectedVersion` on an escalation |
| `SEPARATION_OF_DUTIES` | 403 | resolving an escalation by the administrator who acknowledged it (or by an account that administrator created), or straight from `open`, when it is critical, management-tier, or the resolution is anything other than `remediated`. State is unchanged and a warning `escalation.resolve_refused` is audited (reason `same_admin`, `created_by_acknowledger` or `not_acknowledged`; no note text). Not enforced when `ESCALATION_REQUIRE_SECOND_ADMIN=false` (the resolved event is then marked `sameAdmin`) |
| `INVALID_STATE_TRANSITION` | 409 | escalation action not allowed in the current status (resolve before acknowledge, acknowledge twice, anything but a note once resolved) |
| `PAYLOAD_TOO_LARGE` | 413 | body over `JSON_BODY_LIMIT` |
| `RATE_LIMITED` | 429 | rate limit hit; `Retry-After` and `RateLimit` headers set |
| `INTERNAL_ERROR` | 500 | anything else |

## Routes

### Ops
| Method | Route | Auth | Phase |
|---|---|---|---|
| GET | `/health` → `{status:'ok'}` | public | **0** |
| GET | `/health/ready` → 200 `{status:'ready'}` / 503 `{status:'unavailable'}` | public | **0** |
| GET | `/config/features` → `{phishing, continuousReview}` | auth | 2 |

### Authenticate (included by Security Gate and Admin Dashboard)
| Method | Route | Body | Response | Auth | Phase |
|---|---|---|---|---|---|
| POST | `/auth/login` (rate-limited per email and per IP, failures only) | `{email, password}` | 200 token response + `user` | public | 2 |
| POST | `/auth/refresh` (rate-limited per IP, failures only) | `{refreshToken}` | 200 token response | refresh | 2 |
| POST | `/auth/logout` (idempotent; 204 even for an unknown token) | `{refreshToken}` | 204 | refresh | 2 |
| GET | `/auth/me` | none | 200 `UserDTO` (`EmployeeDTO` / `AdministratorDTO`) | auth | 2 |

### Interact with Security Gate / Escalate Restricted Access (Phase 5; ADR 0015, 0017)
The gate is **pre-access, post-authentication** (U15): the desktop window locks at start-up, the challenge is served to a signed-in employee. Failed logins never count as gate attempts. Administrators are released without a challenge, and every `/gate/*` route is employee-only.

| Method | Route | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| GET | `/gate/status` | employee, allowed while restricted | none | 200 `GateStatusDTO` (pure read, never creates a run) | 401, 403 (administrator) |
| POST | `/gate/challenge` | employee, allowed while restricted | none | 200 `GateStatusDTO`. Get-or-create the open run's current challenge; idempotent (same `challengeId` until answered); opens nothing while `granted` or `restricted`. | 503 `GATE_UNAVAILABLE` |
| POST | `/gate/attempts` | employee | `{ challengeId, selectedIndex }` (strict) | 201 `GateAttemptResultDTO` | 400 (shape; index out of range for the served question, nothing consumed), 409 `GATE_CHALLENGE_STALE`, 403 `ACCESS_RESTRICTED` |
| POST | `/gate/offline-releases` | employee, allowed while restricted | `{ releasedAt, reason, durationSeconds? }` (strict) | 201 `GateOfflineReleaseResultDTO` (200 with `duplicate: true` on a replay) | 400 (`releasedAt` in the future or older than 30 days, unknown field or reason), 429 |
| POST | `/admin/users/:userId/restore-access` | admin | `{ note }` (1..2000, no control characters) | 200 `RestoreAccessDTO` | 400, 404 (unknown user or not an employee), 409 `NOT_RESTRICTED`, 409 `ESCALATION_NOT_ACKNOWLEDGED` |

`POST /gate/challenge` is new in Phase 5 (not in the earlier reserved list): it keeps `GET /gate/status` free of side effects.

```ts
GateStatusDTO = {
  state: 'required' | 'challenge' | 'granted' | 'restricted',
  maxAttempts: number, attemptsRemaining: number,
  challenge: { challengeId: string, prompt: string, options: string[] } | null, // only in 'challenge'
  clearedUntil: string | null,                                                   // ISO; only in 'granted'
  restricted: { referenceId: string, since: string } | null,                     // only in 'restricted'
}
GateAttemptResultDTO = { correct: boolean, explanation: string, xpEarned: number, status: GateStatusDTO }
RestoreAccessDTO = { userId: string, runId: string, escalationId: string, restoredAt: string }
GateOfflineReleaseRequest = { releasedAt: ISO datetime, reason: 'api_unreachable', durationSeconds?: int }
GateOfflineReleaseResultDTO = { recorded: true, duplicate: boolean, escalated: boolean }
```
Schemas (strict, frozen in Step 0): `shared/src/schemas/gate.ts` (requests, authoring) and `shared/src/schemas/gateResponses.ts` (`gateStatusSchema`, `gateAttemptResultSchema`, `restoreAccessSchema`). No response ever contains the correct option, before or after an answer; the `explanation` teaches the concept without naming it. `referenceId` is `GATE-<YYYYMMDD in ORG_TIMEZONE>-<last 6 hex of the run id, upper case>`; administrators find the run through `escalation.sourceRef.id = runId` (`GET /admin/escalations?reason=gate_access_restricted&userId=...`).

Semantics:
- **Challenge lifetime.** An unanswered challenge expires after `GATE_CHALLENGE_TTL` (default 10m, 1m..60m). Answering an expired one is 409 `GATE_CHALLENGE_STALE` and consumes nothing; `GET /gate/status` then reports `required` and `POST /gate/challenge` serves a new question on the same run (attempts already used stay used).
- **Grading always persists.** A wrong answer is always consumed and recorded. If no next question can be drawn (content deactivated), the graded 201 answers `state: 'required'` with the attempts left, and the NEXT `POST /gate/challenge` is the 503 `GATE_UNAVAILABLE`.
- **Offline releases.** When the desktop released the workstation offline (D5-12), it reports it with `POST /gate/offline-releases` as soon as the API answers (also while restricted). The server audits a warning `gate.offline_release` (idempotent per user and `releasedAt`; a future time beyond 5 minutes of clock skew, or older than 30 days, is a 400; limited per employee per hour by `GATE_OFFLINE_REPORT_RATE_MAX`). If the employee is restricted at that moment, a `retriggered` event is appended to their active `gate_access_restricted` escalation (opened first if missing) and the security team is notified: `escalated: true`.
- **States.** `required`: no open run and no valid clearance (a challenge is not issued yet; call `POST /gate/challenge`). `challenge`: an open run with a current question. `granted`: a pass with `clearedUntil` in the future. `restricted`: the latest run is restricted and not restored.
- **Runs and attempts.** One open run per employee; it survives restarts, sign-outs and other workstations until it is passed or restricted. `GATE_MAX_ATTEMPTS` (default 3) attempts per run; every attempt serves a different question. The wrong answer that uses the last attempt restricts the run.
- **Clearance.** A pass sets `clearedUntil = now + GATE_CLEARANCE_TTL` (default 12h). The server does **not** require a clearance on learning routes (D5-8); the workstation cover is the client's job.
- **Restricted access (`ACCESS_RESTRICTED`, 403).** While the latest run is restricted and not restored, every employee route answers 403 `ACCESS_RESTRICTED` except `GET /auth/me`, `GET /config/features`, `GET /gate/status` and `POST /gate/challenge` (`/auth/refresh` and `/auth/logout` are not affected). The restriction survives logout, a new login and another workstation. Restriction opens a critical `gate_access_restricted` escalation for the security team (D5-6) and audits `governance.critical_event_recorded` and `escalation.opened`.
- **Restore.** Needs the escalation acknowledged (`GATE_RESTORE_REQUIRES_ACK`, default true) and a note; audits `gate.access_restored` (warning, note SHA-256 only), appends a `note` event to the escalation and does not resolve it. The next `POST /gate/challenge` opens a fresh run with full attempts.
- **Gate XP.** `xpEarned` is 10 for the first pass of an organisation-local day whose first answer was correct, otherwise 0.

### Learning engine (Phase 3; ADR 0006, 0007, 0008)
All routes are role `employee` (an administrator token gets 403). Identity always comes from the token;
no route takes a user id. Unknown or unpublished modules are 404. Locked resources are 403 with a
specific code. Responses are strict, whitelisted DTOs (`shared/src/schemas/learningResponses.ts`).
| Method | Route | Body | Success | Errors |
|---|---|---|---|---|
| GET | `/modules` | none | 200 `LearningOverviewDTO` (derived status, final test status) | |
| GET | `/modules/:moduleId` | none | 200 `ModuleDetailDTO` (content, exercises without keys, progress, quiz overview) | 404, 403 `MODULE_LOCKED` |
| POST | `/modules/:moduleId/start` | none | 200 `ModuleProgressDTO` (idempotent) | 404, 403 |
| POST | `/modules/:moduleId/exercises/:exerciseId/answers` | `{selectedIndex}` | 200 `ExerciseFeedbackDTO` (key and explanation; first answer recorded) | 400, 404, 403 |
| POST | `/modules/:moduleId/content/complete` | none | 200 `ModuleProgressDTO` (idempotent) | 404, 403, 409 `CONTENT_INCOMPLETE` |
| GET | `/modules/:moduleId/quiz` | none | 200 `QuizOverviewDTO` (never questions) | 404, 403 |
| POST | `/modules/:moduleId/quiz/sessions` | none | 201 `AssessmentSessionDTO` (a random subset of the question pool, preferring questions not seen before; no keys) | 404, 403, 409 `CONTENT_INCOMPLETE` / `ALREADY_PASSED` / `ASSESSMENT_COOLDOWN` / `CONFLICT`, 429 |
| POST | `/modules/:moduleId/quiz/sessions/:sessionId/abandon` | none | 201 `AttemptResultDTO` (`endReason` abandoned or expired) | 404, 403, 409 `SESSION_CLOSED` |
| POST | `/modules/:moduleId/quiz/attempts` | `{sessionId, answers:[{questionId, selectedIndex or null}]}` | 201 `AttemptResultDTO` (graded server-side) | 400, 404, 403, 409 `SESSION_CLOSED` / `SESSION_EXPIRED` / `ASSESSMENT_COOLDOWN` |
| GET | `/final-test` | none | 200 `FinalTestOverviewDTO` (also while locked; no questions) | 404 if none exists |
| POST | `/final-test/sessions` | none | 201 `AssessmentSessionDTO` (15 questions drawn from the pool) | 404, 403 `FINAL_TEST_LOCKED`, 409 `ALREADY_PASSED` / `ASSESSMENT_COOLDOWN`, 429 |
| POST | `/final-test/sessions/:sessionId/abandon` | none | 201 `AttemptResultDTO` | 404, 409 |
| POST | `/final-test/attempts` | as quiz attempts | 201 `AttemptResultDTO` | 400, 404, 403, 409 |
| GET | `/me/attempts` | query `kind, moduleId, limit (1-100, default 20), before` | 200 `{items: AttemptSummaryDTO[], nextCursor}` | 400 |
| GET | `/me/attempts/:attemptId` | none | 200 `AttemptDetailDTO` (review per reveal policy) | 404 (also another user's) |

Notes:
- Completion and badge award are server-side effects of a passing attempt, never a client call. There is no route to set progress, score or a pass flag; a body carrying `score`, `passed` or `correct` is a 400.
- The unlock rule is a strict prefix over published modules in `order`; status is derived, never stored (ADR 0006).
- Leaving a quiz (abandon, starting anew, or expiry) counts as an attempt (score 0). Retries are unlimited until passed. Starting again within `ASSESSMENT_START_REUSE_SECONDS` (default 5) returns the open session instead of replacing it, and session starts are limited per employee (429 `RATE_LIMITED`; every request counts, nothing is refunded). A submission is also refused with 409 `ASSESSMENT_COOLDOWN` while a cooldown is running; abandoning stays allowed.
- A saved attempt is never reported as an error: if a follow-up write fails it is retried, logged, and repaired from the attempt history on the next read. A hook that exceeds `LEARNING_HOOK_TIMEOUT_MS` is dropped and the response still returns 201.
- Review: a submitted attempt shows right/wrong and the explanation; the correct option only once the assessment is passed. Abandoned and expired attempts have an empty review.
- `QuizOverviewDTO` and `FinalTestOverviewDTO` carry `cooldownUntil` (ISO time or null) and `questionCount` is the number a session serves, not the size of the pool; `blockedReason` can be `cooldown`.
- Pass threshold is `Quiz.passingScore` per module (default 70); score is `floor(100*correct/total)`.
- Answer-set problems (unserved or duplicate question, option out of range) are `VALIDATION_ERROR` 400 with paths like `answers.2.questionId`; the session stays open.
- `/me/dashboard` and `/me/progress` (Phase 6) are not implemented; `GET /modules` carries the progress overview now.
- `AttemptResultDTO.effects` is `{ xpEarned?, badge? }`: on the passing attempt of a module `xpEarned` is the whole XP of that module (completion, first try, perfect, practice) and `badge` is the module badge; failed attempts carry `{}`. Both are rebuilt from the attempt history by reconcile if a hook fails.

### View Progress Dashboard
| Method | Route | Auth | Phase |
|---|---|---|---|
| GET | `/me/dashboard`, `/me/progress` | self | 6 |
| PATCH | `/me/onboarding` (FR4; no use case in the UML) | self | 6 |

### Gamification (Phase 4; ADR 0009)
Employee-only, self only: identity comes from the token, no route takes a user id, and any query
parameter is a 400. An administrator token is 403. There is deliberately **no `/me/risk`**: employees
never see their own risk (D4-22).
| Method | Route | Success |
|---|---|---|
| GET | `/me/xp` | 200 `XpSummaryDTO` `{ totalXP, level, tier 1-5, currentLevelFloorXP, nextLevel, nextLevelXP, xpToNextLevel, thresholds }` (thresholds 0 / 300 / 900 / 2000 / 3500) |
| GET | `/me/badges` | 200 `MyBadgesDTO` `{ items: BadgeProgressDTO[], earnedCount, totalCount }`: badges of the current curriculum in order (`position`), then earned badges of modules that left it (`position: null`) |

XP rules: module pass 150, first-try pass +100, perfect score +50, +10 per exercise answered correctly on
the first try; final test 400 / +200 / +100. Failed, abandoned and expired attempts earn nothing and retries
cannot farm XP. XP and badges are projections of the attempt history, so they are idempotent and rebuildable.

### Respond to Phishing Simulation (flag `FEATURE_PHISHING`)
| Method | Route | Auth | Phase |
|---|---|---|---|
| GET/POST | `/phishing/t/:token` (signed, single-use) | public token | flag |
| POST | `/me/phishing/reports` | self | flag |

### Access Admin Dashboard
| Method | Route | Auth | Phase |
|---|---|---|---|
| GET | `/admin/dashboard/kpis`, `/admin/progress`, `/admin/modules/completion`, `/admin/scoreboard`, `/admin/badges/summary` | admin | 7 |

### Manage Users
| Method | Route | Auth | Phase |
|---|---|---|---|
| POST | `/admin/users` body `{name, email, password, role, department?}` → 201 `UserDTO`; 409 `CONFLICT` on duplicate email; `createdBy` is always the calling admin | admin | 2 |
| GET | `/admin/users` | admin | 7 |
| GET, PATCH | `/admin/users/:userId` | admin | 7 |
| POST | `/admin/users/:userId/deactivate` (also revokes all sessions), `/admin/users/:userId/reactivate` | admin | 7 |
| POST | `/admin/users/:userId/password` (administrator reset, D18) | admin | 7 |
| PUT | `/admin/users/:userId/module-assignments` | admin | 7 |

The first administrator is created by the `bootstrap:admin` CLI (decision U20), never over HTTP.

### Manage Module Content
| Method | Route | Auth | Phase |
|---|---|---|---|
| GET, POST | `/admin/modules` | admin | 7 |
| GET, PATCH, DELETE | `/admin/modules/:moduleId` | admin | 7 |
| POST | `/admin/modules/:moduleId/publish`, `/unpublish` | admin | 7 |
| PUT | `/admin/modules/order` | admin | 7 |
| GET, PUT | `/admin/modules/:moduleId/quiz` | admin | 7 |
| GET, POST, PATCH | `/admin/badges[/:badgeId]` | admin | 7 (D4-5; Phase 4 ships the dev badge seed and the authoring schema) |

### Manage Final Assessment
| Method | Route | Auth | Phase |
|---|---|---|---|
| GET, PUT | `/admin/final-test` | admin | 7 |

### View Employee Risk Profiles
| Method | Route | Auth | Phase |
|---|---|---|---|
| Method | Route | Success | Errors |
|---|---|---|---|
| GET | `/admin/risk-profiles?level=Low\|Medium\|High\|unassessed&department=&sort=composite_desc\|composite_asc\|name_asc\|computed_desc&page=&pageSize=` | 200 `{ items: RiskProfileSummaryDTO[], page, pageSize, total }` | 400 |
| GET | `/admin/users/:userId/risk-profile` | 200 `RiskProfileDetailDTO` (profile with evidence and weights, last 20 assessments newest first, active escalations and the last 5 resolved). An employee without a profile yet is 200 with null scores | 400, 404 (unknown id or not an employee) |

Risk model v1 (ADR 0010): every sub-score and the composite are integers 0-100 where **higher means riskier**.
Composite = Knowledge 30% + Behavioural 25% + Simulation 30% + Engagement 15%; dimensions that are not assessed
(or disabled, Simulation while `FEATURE_PHISHING` is off) are dropped and the remaining weights re-normalised
(`coverage` and `effectiveWeightsBp` show this). Bands: 0-39 Low (Green), 40-69 Medium (Amber), 70-100 High (Red).
No composite until first attempts exist on two assessments ("not assessed"). Knowledge uses the first attempt of each
assessment (lowest attempt number). Behavioural v1 is assessment conduct (abandoned/expired attempts, repeated failed
submissions) plus 25 points per assessment cooldown (at most two count). Admin reads return the stored profile and
never recompute.

### Review Governance Escalations
| Method | Route | Auth | Phase |
|---|---|---|---|
Administrator-only (ADR 0011). Escalations open when an employee **enters High**, when an employee reaches
`ESCALATE_AFTER_COOLDOWNS` (default 2) assessment cooldowns on the same quiz or final test within
`ESCALATE_COOLDOWN_WINDOW` (default 7 days), and for critical events (gate restriction, credentials submitted in a
simulation; `critical`; the gate restriction goes to the `security_team` tier (D5-6, ADR 0015), the simulation event stays `management`; the producers are the Phase 5 gate and the phishing flag). Every escalation
and every state change writes an audit entry (outbox: a failed audit write leaves the event flagged and the sweeper
completes it; the PATCH then answers 500).
| Method | Route | Body / query | Success | Errors |
|---|---|---|---|---|
| GET | `/admin/escalations` | `status=open\|acknowledged\|resolved\|active, severity, reason, userId, page, pageSize` | 200 `{ items: EscalationSummaryDTO[], page, pageSize, total, counts: {open, acknowledged} }` | 400 |
| GET | `/admin/escalations/:escalationId` | none | 200 `EscalationDetailDTO` (context snapshot, events, notes) | 400, 404 |
| PATCH | `/admin/escalations/:escalationId` | `{action:'acknowledge', expectedVersion, note?}` \| `{action:'note', note, expectedVersion?}` \| `{action:'resolve', expectedVersion, resolution, note, managementReference?}` | 200 `EscalationDetailDTO` | 400 (a management-tier resolve needs `managementReference`), 404, 409 `INVALID_STATE_TRANSITION` / `CONFLICT`, 500 audit failed (state change stands) |
| GET | `/admin/audit-logs` (read-only) | `action, severity, outcome, actorId, targetType, targetId, from, to, before (seq cursor), limit 1-200` | 200 `{ items: AuditLogDTO[], nextCursor }` newest first by `seq` | 400 |

`EscalationSummaryDTO` also carries `retriggerCount` and `lastRetriggeredAt`: once an escalation has 150 events, further cooldown retriggers only move these counters (50 events stay reserved for administrator actions). `managementReference` and notes reject control characters and lone surrogates (400).

`EscalationDetailDTO` also carries `acknowledgedBy` and `resolvedBy` (`{id, name}` or null), and each event a `sameAdmin` flag (true when, with `ESCALATION_REQUIRE_SECOND_ADMIN=false`, the acknowledger resolved an escalation that would otherwise have needed a second administrator; such a resolution is audited as a warning).

**Disengagement (`disengaged_unassessed` and `disengaged_no_progress`, elevated, security team).** An active employee with an unfinished curriculum and no progress for `DISENGAGED_AFTER_DAYS` (default 14, 1-365) is flagged: `disengaged_unassessed` while the profile is still "not assessed", `disengaged_no_progress` once assessed. Progress is the latest of account creation, module start, exercise answer, content completion, any attempt, and the resolution of an earlier flag. Evaluated by a bounded, paged scan in the sweeper, on each risk recompute and in `gamification:reconcile`. At most one active flag per employee (database-enforced); it is never auto-resolved; after an administrator resolves it, a new one opens only after another full period without progress. Deactivated employees and administrators are never flagged. `RiskProfileSummaryDTO` carries `unassessedSince` (account creation while not assessed, else null) and `disengaged` (an active flag of either reason exists).

Resolutions: `remediated`, `risk_accepted`, `false_positive`, `no_action_required`. Note text is stored on the
escalation only; audit entries carry its SHA-256 and length. POST, PUT, PATCH and DELETE on
`/admin/audit-logs` do not exist (404).

### Generate Awareness Reports
| Method | Route | Auth | Phase |
|---|---|---|---|
| POST | `/admin/reports` | admin | 7 |
| GET | `/admin/reports/:reportId` | admin | 7 |

### Configure Phishing Campaigns (flag `FEATURE_PHISHING`)
| Method | Route | Auth | Phase |
|---|---|---|---|
| GET, POST | `/admin/phishing-campaigns` | admin | flag |
| GET, PATCH | `/admin/phishing-campaigns/:campaignId` | admin | flag |
| POST | `/admin/phishing-campaigns/:campaignId/deploy` | admin | flag |
| GET | `/admin/phishing-campaigns/:campaignId/outcomes` | admin | flag |

### Continuous awareness (flag `FEATURE_CONTINUOUS_REVIEW`; FR16, no use case in the UML)
| Method | Route | Auth | Phase |
|---|---|---|---|
| GET, POST | `/admin/review-cycles` | admin | flag |
| GET | `/me/reviews` | self | flag |

## System-triggered use cases (no route)
Award Badge, Update Risk Profile, Trigger Governance Escalation and Escalate Restricted Access are
internal services called by the routes above. Phase 4 wires Award Badge and Update Risk Profile to the
learning hooks (every attempt recomputes the profile), and `governance.recordCriticalEvent` is the entry
point Phase 5 (gate) and the phishing flag call. Reconcile (`gamification:reconcile`, plus the in-process
sweeper) repairs anything a failed hook or audit write left behind. Each one that escalates writes an immutable audit-log
entry (Phase 2 provides the append-only `AuditLog` model and service). Authentication events
(login success/failure, refresh-token reuse, logout, user creation, admin bootstrap) are audited too.
Since Phase 4 the audit log is a keyed hash chain (HMAC-SHA256 with `AUDIT_CHAIN_SECRET`, dense `seq`, ADR 0012);
`npm run audit:verify -w @csense/server` detects edits, deletions and reordering, and also fails on rows with a non-numeric `seq` and on rows without a `seq` dated after the chain started.
