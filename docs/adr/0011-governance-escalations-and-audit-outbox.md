# ADR 0011: Governance escalations, their state machine and the audit outbox

- Status: Accepted 2026-11-07 (Phase 4 plan, docs/architecture/phase-04-plan.md, decisions D4-13 to D4-21)
- Date: 2026-11-06
- Deciders: Technical architect, product owner (approval), security-tester (review)
- Amends: ADR 0005, the sentence "the audit write happens first for escalations so a failure aborts the action"

## Context
The Client Needs require a governance and escalation workflow: elevated risk triggers a targeted review
and notifies the security team; critical events (for example credential submission in a phishing
simulation) are logged in an auditable record and escalated for management review. The organisation
must keep auditable, defensible logs of escalations **and of its responses to them** (ISO/IEC
27001:2022, NIST SP 800-50, CIS v8 Control 14). Use cases: Trigger Governance Escalation (extends
Respond to Phishing Simulation), Escalate Restricted Access (extends Interact with Security Gate,
Phase 5), Review Governance Escalations and View Employee Risk Profiles (administrator).

Constraints:
- ADR 0008: risk work runs inside the employee's quiz submission and must never fail it.
- There are no transactions (standalone MongoDB, D3-23), so an escalation write and its audit entry
  cannot be atomic.
- ADR 0005 said "audit first" for escalations. Audit-first leaves a false audit record whenever the
  business write then fails or loses a race (two recomputations, two administrators). That is worse
  for defensibility than a short delay before the record appears.
- There is only one privileged role (`administrator`); "management" is not a role.

## Decision
1. **Escalation entity** (`escalations`): subject employee, `reason`, `severity`, `reviewTier`,
   `status`, a context snapshot (risk level, composite, sub-scores, the triggering `riskassessments`
   id or source event), assignee, resolution, and an embedded, capped list of `events`. A `version`
   counter gives optimistic concurrency.
2. **Triggers:**
   | Reason | When | Severity | Review tier |
   |---|---|---|---|
   | `risk_level_high` | a classified profile moves into High (from null, Low or Medium) | `elevated` | `security_team` (the targeted review) |
   | `simulation_credentials_submitted` | phishing outcome (flag; producer arrives with the flag phase) | `critical` | `management` |
   | `gate_access_restricted` | security-gate attempts exhausted (Phase 5 producer) | `critical` | `management` |
   A move into Medium is audited (`risk.level_changed`, warning) but does not open an escalation.
   At most one active (open or acknowledged) `risk_level_high` escalation exists per employee
   (partial unique index on `{ userId, reason }` where `active: true`); a new entry into High while one
   is active appends a `retriggered` event instead. Falling out of High never auto-resolves: a human
   must record the response. Critical events always open a new escalation, de-duplicated by source id.
3. **State machine** (pure function in `@csense/shared`):
   `open --acknowledge--> acknowledged --resolve--> resolved`. `note` is allowed in every state,
   including after resolution. `open --resolve-->` and every other move is rejected with 409
   `INVALID_STATE_TRANSITION`. `resolve` requires a resolution (`remediated`, `risk_accepted`,
   `false_positive`, `no_action_required`) and a note; on `management` tier it also requires a
   `managementReference` (meeting, ticket or decision reference), which is how "escalated for
   management review" is evidenced without a new role. No reopen in v1: a new trigger opens a new
   escalation. A stale `expectedVersion` returns 409 `CONFLICT`.
4. **Audit outbox.** Every state change is one atomic `findOneAndUpdate` that changes the state **and**
   pushes the event with `audited: false`. The audit entry is then written with an idempotency key
   `escalation:<id>:event:<eventId>` and the event is flagged `audited: true`. If the audit write fails:
   - in the hook path, the error is logged, a reconcile marker is written, and the submission still succeeds;
   - in the administrator's PATCH, the response is 500 `INTERNAL_ERROR`, and the state change stands
     (its audit intent is already durable in the same document).
   The reconcile sweeper (and CLI) writes every event with `audited: false`; the idempotency key makes
   that safe to repeat. Invariant, checked by reconcile and tests: every escalation event has exactly
   one audit entry. Free-text notes are kept in the escalation; the audit entry stores the note's
   SHA-256 and length (not the text, which may be personal data and would exceed the 2 KB metadata cap),
   so any later edit of a note is detectable.
5. **Notification of the security team:**
   - Phase 4 is in-app only: the escalation record itself, open and acknowledged counts on
     `GET /admin/escalations`, and a structured `warn` log line `escalation.opened` (for log forwarding
     in Phase 10).
   - Phase 7: the admin console polls the counts and raises a native OS notification (Electron
     `Notification`, NFR "native OS notifications").
   - Email is not planned before Phase 10, and only behind SMTP configuration.
   A `SecurityTeamNotifier` interface is introduced now with a log-only implementation, so later channels plug in without touching the
   escalation service.
6. **Critical-event entry point.** `governance.recordCriticalEvent({ userId, reason, sourceRef, occurredAt })`
   is an internal service (no HTTP route). It writes `governance.critical_event_recorded` (critical) and
   opens the escalation. Phase 5 and the phishing flag call it.

## Consequences
- Positive: the state and its audit intent are atomic; audit records are never false; repeated
  delivery and reconcile are safe; the response trail (who acknowledged, notes, resolution, management
  reference) is complete and tamper-evident together with ADR 0012.
- Negative: an audit entry can lag its state change by up to one sweep interval (default 5 min) after a
  failure; an administrator can see a 500 for a change that did happen (the detail view shows it).
  The escalation document is mutable, so its notes rely on the audit hash, not on immutability.
  Escalating only on High may under-alert during roll-out; the product owner may switch Medium on
  (decision D4-13), which only changes the trigger table.

## Amendments (implementation, Phase 4)
- Added reason `repeated_assessment_cooldowns` (elevated, security team): `ESCALATE_AFTER_COOLDOWNS` cooldown audit entries (default 2) for the same assessment inside `ESCALATE_COOLDOWN_WINDOW` (default 7 days). One active escalation exists per employee and assessment; further cooldowns add a `retriggered` event. The check runs on every attempt and in reconcile, whether or not the risk profile changed.
- The uniqueness rule for active escalations is a partial index on `{userId, reason, scopeKey}` where `active` is true and `scopeKey` is a string (`risk`, `assessment:<id>`). Critical events have no scope key.
- The security team is notified right after the escalation is stored and before its audit entry is written, so a failing audit write cannot suppress the notification.

## Amendments (security review, Phase 4)
- **Event budget (P4-M1).** System events (`opened`, `retriggered`) may only use the first 150 of the 200 event slots (`ESCALATION_ADMIN_RESERVE` = 50 are kept for administrators). After that a retrigger writes no event: it increments `retriggerCount` and sets `lastRetriggeredAt` on the escalation, once per source (`lastRetriggerRef`), through a conditional update that checks the events length. Counter-only retriggers write no audit entry and do not bump `version`, so they cannot cause administrator conflicts. The escalation therefore always stays closable and bounded.
- **Cooldown facts (P4-M1).** Cooldown entries are read newest first (so the cap drops the oldest and "latest" is right), and only entries with a numeric `seq` count (P4-L1).
- **Repair path (P4-M2).** `reconcileUser` always runs the cooldown check, outside the profile drift test, so a failure after the profile write is repaired by the sweeper and by the reconcile CLI.
- **Cooldown audit (P4-L7).** The Phase 3 cooldown entry now has the idempotency key `cooldown:<userId>:<assessmentId>:<attemptNumber>`, and a failed write leaves an `audit` reconcile marker. Reconcile replays the attempt history with the cooldown rule (a streak of failed attempts, reset by a pass and by each cooldown, using `ASSESSMENT_COOLDOWN_AFTER_FAILS`) and writes any missing entry with the same key, dated at the attempt (`metadata.rebuilt: true`). If the rule is changed in configuration, rebuilt entries follow the rule in force at reconcile time.
- **Markers (P4-L4).** A claim counts the attempt (never reset by a failure) and leases the marker; a failed reconcile backs off 30 s, 1 min, 2 min ... up to 1 h. A sweep handles each marker once. After 10 claims the marker is parked: logged once, kept for operators, never claimed again (an operator runs `gamification:reconcile`). A marker that gained a reason while it was being processed is handed back (attempts reset) instead of deleted.
- **Management reference (P4-L6).** `managementReference` follows the same character rules as notes (no control characters, no lone surrogates).

## Amendment (separation of duties, Phase 4 safeguard P4-L8)
Resolving an escalation must be done by a **different administrator than the one who acknowledged it** when the severity is `critical`, the review tier is `management`, or the resolution is `risk_accepted`. A violation is 403 `SEPARATION_OF_DUTIES`, leaves state unchanged and writes a `warning` `escalation.resolve_refused` audit entry (reason `same_admin` or `not_acknowledged`, never note text). Resolving such an escalation straight from `open` is refused with the same code, so a second person must acknowledge it first; other escalations keep the plain 409 state error, and a resolved escalation is always the plain state error. The rule is enforced inside the same conditional write as the transition (`acknowledgedBy` must be neither null nor the actor), so a race cannot bypass it; `acknowledgedBy` cannot change once set. `ESCALATION_REQUIRE_SECOND_ADMIN=false` (single-administrator organisations) allows it: the resolved event gets `sameAdmin: true` and the audit entry is a warning. `acknowledgedBy` and `resolvedBy` are exposed in the detail DTO.

## Amendment (separation of duties, Phase 4 safeguard P4-L8)
Resolving an escalation must be done by a **different administrator than the one who acknowledged it** when the severity is `critical`, the review tier is `management`, or the resolution is `risk_accepted`. A violation is 403 `SEPARATION_OF_DUTIES`, leaves state unchanged and writes a `warning` `escalation.resolve_refused` audit entry (reason `same_admin` or `not_acknowledged`, never note text). Resolving such an escalation straight from `open` is refused with the same code, so a second person must acknowledge it first; other escalations keep the plain 409 state error, and a resolved escalation is always the plain state error. The rule is enforced inside the same conditional write as the transition (`acknowledgedBy` must be neither null nor the actor), so a race cannot bypass it; `acknowledgedBy` cannot change once set. `ESCALATION_REQUIRE_SECOND_ADMIN=false` (single-administrator organisations) allows it: the resolved event gets `sameAdmin: true` and the audit entry is a warning. `acknowledgedBy` and `resolvedBy` are exposed in the detail DTO.
