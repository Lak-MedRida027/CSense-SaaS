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
