# ADR 0020: Employee journey: bridge v1 extension, closed-book rule and onboarding state

- Status: Accepted 2026-11-20 (proposed 2026-11-10) (Phase 6 plan, docs/architecture/phase-06-plan.md sections 4 and 6, decisions D6-1, D6-2, D6-3, D6-8, D6-9, D6-10)
- Date: 2026-11-10
- Deciders: Technical architect, product owner (approval), security-tester (review)
- Builds on: ADR 0013 (bridge v1, IPC registry), ADR 0014 (main-process API client), ADR 0016 (lockdown bound to a server session), ADR 0006 and 0007

## Context
Phase 6 wires the full employee journey. Each renderer need is a new main-process operation plus a bridge method (ADR 0013, by design). The renderer is untrusted, so the bridge must stay enumerable, validated and minimal. Three questions need a recorded answer:
1. Where "onboarding seen" lives. The contract reserves `PATCH /me/onboarding` (Client Needs FR4) and the data model lists an "onboarding flag (6)". Employees may use more than one workstation.
2. Whether the dashboard needs the reserved aggregate `/me/dashboard` and `/me/progress`, or can compose existing routes.
3. What the renderer may do while a quiz runs under lockdown. Lockdown blocks the OS-level escapes, but the bridge would still let the page open module content or answer practice exercises (which return keys and explanations) during the quiz: an open-book channel.

## Decision
1. **Bridge stays v1, additive.** Eight invoke channels are added (22 in total): `learning.getModule`, `learning.startModule`, `learning.answerExercise`, `learning.completeContent`, `learning.getFinalTestOverview`, and a new area `me` with `getXp`, `getBadges`, `completeOnboarding`. Each maps to exactly one operation in the closed operations table. No channel takes a URL, a path or a user id. Renderer and preload ship in one bundle with main, so an additive change does not need `bridgeVersion: 2`; a breaking change still would.
2. **Declarative channel policy in main.** Every channel has an entry in `IPC_CHANNEL_POLICY`: `{ requiresRelease: boolean, duringLockdown: 'allow' | 'deny', ratePerSecond }`. `assertIpcRegistry` fails start-up if a channel has no policy. All `learning.*` and `me.*` channels require a released gate and are **denied while lockdown is active** (`LOCKDOWN_ACTIVE`, a new desktop error code): the closed-book rule. Mutating channels get lower rate ceilings (exercise answers 5/s, start and complete 2/s, onboarding 1/s) so one mutating channel cannot be hammered. **Per-channel ceilings alone do not protect the shared server budget** (D5-24: one limit per egress IP): a single channel at 20/s would drain it in about a minute. Every API-calling channel (`callsApi` in the policy) therefore also draws from **one aggregate token bucket in main: sustained 5 calls/s, burst 20** (`AGGREGATE_API_RATE`); refused calls take no token. The server limiter keying is unchanged (open decision D-10).

   **In-flight calls.** The policy is checked before the API call and again after it returns. Gate, lockdown and session each keep an epoch counter that rises when the workstation leaves `released`, a lockdown begins, or the identity changes; if the policy fails or an epoch moved during the call, the payload is discarded and the call answers `GATE_LOCKED` or `LOCKDOWN_ACTIVE` (security review P6-L1, P6-I1).
3. **Onboarding state is server-side.** `Employee.onboarding: { outcome: 'completed' | 'skipped', at } | null`, written by `PATCH /me/onboarding` (first write wins, idempotent). It is returned on `EmployeeDTO` from login and `/auth/me`, so main knows at session start whether to show onboarding (`SessionUserView.onboardingRequired`). Skipping counts as seen.
4. **Display preferences are device-local.** Theme, motion and text size are stored in renderer `localStorage` (`csense.ui.v1`), schema-checked on read, defaults on any error. `userData` is per Windows profile, so this is per user on normal workstations. No token, id or content is ever written there.
5. **No aggregate dashboard route.** The dashboard composes `GET /modules`, `GET /me/xp` and `GET /me/badges` (three cheap reads, cached in the renderer and refreshed on mount and after mutations). `/me/dashboard` and `/me/progress` are removed from the contract.
6. **Errors steer the gate.** An `ACCESS_RESTRICTED` answer to any journey call makes main re-check the gate, which re-locks the workstation into the restricted state.

## Consequences
- Positive: every new capability is listed, schema-checked, rate-bounded and policy-bound in one reviewable table; questions or practice keys cannot reach the renderer during a quiz through the bridge; onboarding is shown once per employee, not once per workstation; the server API grows by one route only.
- Negative: the closed-book rule is enforced by main, not the server; a client with a stolen access token could still read content during a session (accepted as in D5-8: the token never leaves main). Dashboard loads cost three requests instead of one. Preferences do not follow an employee across workstations.
- Alternatives rejected: a local onboarding flag (shows again on every new workstation); a server-side "open session blocks content" check (an abandon that has not reached the server would lock content for up to the session TTL); `bridgeVersion: 2` (no breaking change).
