# ADR 0015: Pre-access security gate

- Status: Accepted 2026-11-10 (Phase 5 plan section 2 and section 6, decisions D5-1 to D5-8, D5-11, D5-12)
- Date: 2026-11-10
- Deciders: Technical architect, product owner (approval), security-tester (review)
- Builds on: ADR 0005 (access gate), ADR 0011 (escalations, `recordCriticalEvent`), ADR 0012 (audit chain)
- Amends: ADR 0011 trigger table, row `gate_access_restricted` (review tier; pending D5-6)

## Context
The Client Needs require the following:
- a pre-access security gate at start-up that grants full access only after a required interaction
- limited retries, then a restricted-access state that alerts the security team
- an application that sits in front of workstation access rather than a voluntary portal

The use case Interact with Security Gate includes Authenticate and is extended by Escalate Restricted Access. The Phase 1 UI decided "sign-in + one check question, 3 attempts". The contract reserved `GET /gate/status`, `POST /gate/attempts` and `POST /admin/users/:userId/restore-access`, and annotated U15 as "pre-auth flow".

CSense is a user-space Electron application. It cannot replace the Windows logon (a Credential Provider is native code) or intercept Ctrl+Alt+Del, and it cannot stop its own process from being killed.

## Decision
1. **What the gate is.** A post-logon, pre-use gate.
   - A per-user login item starts the app (packaged builds).
   - A single instance is enforced.
   - At start-up, before any network call, main shows a frameless, kiosk, full-screen, always-on-top, non-closable window, and covers every other display.
   - Close and Alt+F4 are refused while locked, but OS logoff and shutdown are never blocked.
   - Unlock-screen and resume re-check the gate.
   - Process kill cannot be prevented. The gate returns at the next logon, and the missing pass is visible server-side.
   - Machine-wide start, Task Manager restrictions, Assigned Access and a relaunch watchdog are Phase 10 fleet controls.
2. **Placement (resolves U15).** The window locks before authentication. The challenge is served after authentication: the routes are employee-only.
   - An anonymous gate has no subject to restrict or escalate, and its counter is resettable.
   - Failed logins never count as gate attempts, so nobody can restrict a colleague by typing their email.
   - Administrators are released after sign-in without a challenge.
3. **Required interaction.** One awareness question from a dedicated pool (3 to 6 options).
   - Each attempt serves a different question (no elimination bypass).
   - The explanation is shown after each answer; the correct option is never returned.
   - Re-requesting a challenge returns the same question until it is answered.
4. **Runs and attempts.**
   - A `GateRun` holds the attempt count (`GATE_MAX_ATTEMPTS`, default 3) and the current challenge (`challengeId`, plus a server-held key snapshot).
   - At most one run per employee is open. It persists across restarts, sessions and workstations, and closes only by a pass or by restriction.
   - Each answer is a compare-and-set on `{status: open, current.challengeId, attemptsUsed}`: single use, race safe.
   - The answer is recorded in the append-only `gateanswers`.
5. **Clearance.** A pass grants `clearedUntil = now + GATE_CLEARANCE_TTL` (default 12 h).
   - The gate is shown at every start-up. It auto-continues while the clearance is valid, and asks a new question after it expires (about once per working day).
6. **Restriction** (the last attempt wrong). The run becomes `restricted`. Then:
   - `User.gateRestriction` is set. It is a cache read by the access gate.
   - `governance.recordCriticalEvent({ reason: 'gate_access_restricted', sourceRef: { type: 'gate_event', id: runId } })` writes the critical audit entry, opens exactly one `critical` escalation and notifies the security team.
   - Risk is recomputed.

   Every step after the run write is idempotent and repaired by reconcile (marker reason `gate`). The review tier comes from a shared `CRITICAL_EVENT_POLICY` (recommended `security_team`, D5-6).
7. **Server enforcement.**
   - `AuthContext.accessRestricted` is loaded with the user, at no extra query.
   - Employee routes answer 403 `ACCESS_RESTRICTED` unless the route declares `allowWhileRestricted`: only `/auth/me`, `/config/features`, `/gate/status` and `/gate/challenge` do.
   - The clearance itself is not required by learning routes (D5-8). The workstation cover is the client's job, while pass/fail, attempts and restriction are the server's.
8. **Restore.** `POST /admin/users/:userId/restore-access` (admin):
   - It requires an acknowledged escalation and a note.
   - It marks the run restored and clears the flag.
   - It audits `gate.access_restored` with the note's SHA-256 only, and adds an escalation note.
   - It does not resolve the escalation. The next challenge opens a fresh run.
9. **Release is decided by main.** The window unlocks only after main itself received `granted` (or an administrator session) from the server. A renderer request to continue is otherwise refused.
10. **Offline.** Default: fail open after a 120 s grace with an explicit "Continue offline", re-locking as soon as the API answers and no clearance exists. A build flag selects fail-closed.
11. **Routes.** `GET /gate/status` (pure read), `POST /gate/challenge` (new, idempotent get-or-create), `POST /gate/attempts`, and the admin restore.

## Amendments after the Phase 5 security review (2026-11-10)
- **P5-M2, grading always persists.** A wrong answer is always compare-and-set (attempt consumed, answer recorded) before anything that can fail. If no next question can be drawn, the run is left open with `current: null`, the graded response reports `required`, and the next `POST /gate/challenge` answers 503. Grading never answers 503, so there is no free "wrong" oracle.
- **P5-L3 and P5-L6, the flag is a cache with two repairs.** Restore writes a `gate` reconcile marker when clearing the flag fails. The sweeper also scans (bounded, indexed, paged) for restricted unrestored runs whose employee lacks the matching `gateRestriction` or whose escalation is missing, and for flags that point at runs restored in the last 30 days, and reconciles those employees.
- **P5-L4, access never returns without its record.** Restore order is claim, audit (key `gate:restore:<run>:<claim time>`), clear flag, then the administrator note on the escalation. If the audit cannot be written the claim is rolled back and the escalation gets a "Restore rolled back" note instead. If the rollback itself fails, the flag is still set, and `repairGate` writes the missing `gate.access_restored` entry (actor = `restoredBy`, `repaired: true`) before it clears the flag.
- **P5-L5.** After writing the flag, the writer re-reads the run and clears the flag if a restore completed in between.
- **Offline-release reporting (P5-M1).** `POST /gate/offline-releases` records a warning `gate.offline_release` audit entry (idempotent per user and instant, time-window checked, rate limited per employee). A restricted employee who got in offline also triggers a `retriggered` event on their `gate_access_restricted` escalation and a security-team notice.
- **P5-I4, challenge TTL.** `GATE_CHALLENGE_TTL` (default 10m): an expired challenge is stale (409), consumes nothing, and is replaced on the next challenge request.
- **P5-I7.** Gate XP facts are read newest first, so the bounded read can only drop the oldest.

## Consequences
- Positive:
  - The pass, fail and restriction decisions are server-authoritative and tamper-resistant: no client fields, single-use challenges, attempts that cannot be reset.
  - Restriction reuses the Phase 4 escalation, audit chain and reconcile, so it is exactly-once and auditable.
  - What the gate does and does not do is stated honestly.
- Negative:
  - A determined local user can kill the process. Real enforcement needs Phase 10 fleet policy.
  - Fail-open offline is bypassable by unplugging the network for the day (it is logged locally).
  - Restriction blocks a person until an administrator acts, and Phase 5's alert is in-app plus a log line until Phase 7 adds OS notifications for administrators.
  - One route beyond the reserved contract.

## Amendment: Phase 5 security review, desktop findings (P5-M1, P5-L1, P5-L2)
- Status: Accepted 2026-11-10 (desktop track). The server-side offline-release route is amended in the backend section of this ADR.

1. **A restricted employee cannot start offline to get the workstation back (P5-M1).** D5-5 (restricted is a full block until an administrator restores access) outranks D5-12 (fail open after 120 s).
   - Main keeps the **last server-known gate state per user** (restricted, cleared until X, or required), written from every gate status and attempt response. It is encrypted with `safeStorage` like the token store and never written in plaintext; with no OS encryption it is memory-only.
   - "Continue offline" is not offered, and `gate.continueOffline` is refused, when the last known state for the stored user is `restricted`. With no stored state D5-12 is unchanged (fail open after the grace period).
   - Every offline release is queued (encrypted, per user) and reported with `POST /gate/offline-releases { releasedAt, reason: 'api_unreachable', durationSeconds }` when the API next answers. Delivery is at least once and idempotent per `releasedAt`; entries for another user are never sent under a different bearer token; a report the server refuses as malformed is dropped.
   - Residual risk, accepted and documented in the README: making only the API unreachable still works for an employee who has never been restricted on that machine. The release is audited after the fact.
2. **An answer that lands after sign-out is discarded (P5-L1).** `submitAnswer` captures a session generation before the request and drops the result if any session change happened meanwhile, so a late grant can never move the gate of a signed-out (or different) user.
3. **Identity changes re-gate (P5-L2).** `session.login` is refused unless main's gate is waiting at the Login step, and any sign-in that still arrives while the workstation is released re-locks and re-checks the gate (an administrator becoming an employee, or another account).

