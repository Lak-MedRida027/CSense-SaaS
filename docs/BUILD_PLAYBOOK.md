# CSense Build Playbook

How to build the CSense platform with Claude Code using a dedicated agent per role
(UI/UX, backend, frontend, debugging, testing, security, deployment), from empty folder to live app.

This playbook has four parts:
1. The mental model (how the agents actually work together)
2. One-time setup
3. The daily operating loop
4. The eleven phases, each with a copy-paste prompt and a verification gate

A ready-to-use `.claude/` starter (CLAUDE.md + all role agents + helper commands) ships alongside
this file in `csense-claude-starter.zip`. Unzip it at your repo root and you have everything in parts
1 to 2 already created.

---

## 1. The mental model

Claude Code is not a fleet of robots that builds the whole app while you sleep. It is **one tech
lead (the main session) that delegates scoped jobs to specialist subagents**, with you as the
engineering manager who reviews and approves at each gate. Getting this right is what makes the
difference between a clean build and a pile of half-working code.

Three primitives do all the work:

- **CLAUDE.md** - project memory auto-loaded every session. Your stack, rules, security baseline,
  and open questions live here so no agent forgets them.
- **Subagents** (`.claude/agents/*.md`) - each has its own name, description, tools, model, and
  system prompt, and runs in its **own context window**. That isolation is the point: the
  security-tester reasons about attacks without the backend-engineer's 40 files cluttering its head.
  You invoke one explicitly ("Use the backend-engineer subagent to...") or let Claude route by the
  description.
- **Slash commands** (`.claude/commands/*.md`) - saved prompts for repeated actions like `/verify`
  and `/ship-phase`.

The eight agents and who does what:

| Agent | Role | Used in phases |
|---|---|---|
| `architect` | Plans each phase, data model, API contracts, ADRs. Writes no feature code. | start of every phase |
| `ui-ux-designer` | Design tokens, components, wireframes, accessibility. | 1, 5, 6, 7 |
| `backend-engineer` | Express + MongoDB API, auth, risk engine. | 2, 3, 4, 7 |
| `frontend-engineer` | Electron shell, security gate, React UI. | 5, 6, 7 |
| `test-engineer` | Unit, integration, e2e suites. | every phase; concentrated in 8 |
| `security-tester` | AuthZ/IDOR, Electron + kiosk hardening, scans, compliance. | 2 review, then 9 |
| `debugger` | Reproduce, isolate, fix, regression-test. | on demand; concentrated in 10 |
| `devops-deployer` | CI/CD, electron-builder, backend deploy, CDN. | 0 skeleton, then 10 |

Why one agent per role instead of one big session:
- **Focus and context budget.** A fresh, narrow context produces sharper work and fewer hallucinated
  cross-dependencies.
- **Separation of duties.** The agent that writes a security control should not be the only one that
  signs off on it. The security-tester reviewing the backend-engineer's auth is a real control.
- **Reusability.** The same `backend-engineer` definition behaves consistently across phases.

The honest limits: subagents cannot talk to each other directly. The main session is the only
integrator. It passes a written handoff (a plan, a findings report, a file list) from one agent to
the next. So your job at each gate is to make sure that handoff is correct before the next agent
builds on it.

---

## 2. One-time setup

```bash
mkdir csense && cd csense
git init && git branch -M main
# unzip the starter here -> gives you CLAUDE.md, .claude/agents, .claude/commands, docs/
# copy your three requirement files into docs/:
#   CSense_Client_Needs.docx, CSense_UseCase_UML.png, CSense_Class_UML.png
claude            # launch Claude Code in this folder
```

In the first session, confirm the toolchain is loaded:

```
/agents          # should list architect, ui-ux-designer, backend-engineer, frontend-engineer,
                 # debugger, test-engineer, security-tester, devops-deployer
```

Answer the four **Open Questions** at the bottom of CLAUDE.md now if you can (module count, pass
threshold, phishing scope, client identity). Every agent reads them; resolving them up front removes
the biggest source of wrong guesses.

Model routing tip: the starter sets `architect`, `ui-ux-designer`, and `security-tester` to Opus
(judgement-heavy) and the implementation agents to Sonnet (fast, capable coders). Adjust in each
agent's frontmatter to fit your plan and budget.

---

## 3. The daily operating loop

Run this loop **once per phase**. It is the whole method.

1. **Clear context.** `/clear` so the new phase starts clean. Stale context is the main cause of
   drift.
2. **Plan first (plan mode).** Press `Shift+Tab` to enter plan mode, then paste the phase's
   **Plan prompt** (the architect produces a plan and writes no code). Read the plan. This is your
   cheapest chance to catch a wrong direction.
3. **Approve or correct the plan.** Push back in plain language. Re-plan until it is right.
4. **Branch.** `git checkout -b phase-NN-name`.
5. **Implement.** Paste the phase's **Build prompt**, which names the subagent(s) to use. Let it work,
   and review diffs as they come. Keep diffs small; interrupt and redirect early if it wanders.
6. **Verify (the gate).** Run `/verify`. Then do the phase's manual checks (run the app, click the
   flow). Nothing proceeds on an unverified gate.
7. **Independent review where it matters.** For security-sensitive phases, hand the diff to the
   `security-tester` before you accept it. For anything broken, hand it to the `debugger`.
8. **Ship the phase.** Run `/ship-phase NN name`, review the commit + PR text, then commit and open
   the PR yourself. Merge after you are satisfied.
9. **Update CLAUDE.md** if a decision changed, then `/clear` and start the next phase.

Rules of thumb that keep it healthy:
- One phase per branch, one concern per commit. Reviewable diffs beat big-bang drops.
- If the agent says "done", you are not done until `/verify` is green and you ran the thing.
- When an agent is guessing, stop it and answer the question. Guessing compounds.
- Commit working states often so you always have a clean point to roll back to.

---

## 4. The eleven phases

Each phase below gives you a **Plan prompt** (paste in plan mode) and a **Build prompt** (paste to
implement), plus the **gate** that proves it is done. The prompts are deliberately explicit about the
agent, the deliverables, the constraints, and "stop and ask if ambiguous", because that is what makes
an agent reliable.

The dependency order is linear (each phase builds on the last), except that testing, debugging, and
security review run continuously and simply concentrate in their own phases.

---

### Phase 0 - Foundation and architecture

**Goal:** a building monorepo with the data model, API contract, tooling, and CI skeleton. No
features yet.

**Plan prompt**
```
Use the architect subagent. Read CLAUDE.md and everything in docs/ (the needs doc and both UML
diagrams). Produce a Phase 0 plan to scaffold the CSense monorepo:
- The desktop/ (electron-vite + React + TS), server/ (Express + TS), shared/ (TS) workspace layout
  with a single root package manager setup, TypeScript project references, ESLint + Prettier,
  Vitest, and Playwright configured.
- The MongoDB/Mongoose schema derived strictly from docs/CSense_Class_UML.png: list every collection,
  its fields and types, indexes (unique email, unique module order), and relationships. Flag anything
  the diagram leaves ambiguous under "Decisions needed".
- The initial REST API contract (resource list, routes, methods, auth level) mapped to the use cases
  in docs/CSense_UseCase_UML.png.
- A GitHub Actions CI skeleton that runs lint, typecheck, test, build.
- The list of files you will create. Write ADRs for the stack and the monorepo tooling choice.
Do not write feature code. End with the Phase 0 acceptance checklist.
```

**Build prompt**
```
Implement the approved Phase 0 plan. Scaffold the monorepo exactly as planned: workspaces, TS config,
lint/format, test runners, the Mongoose models and shared types from the class diagram (schema only,
no business logic), a health-check endpoint, env handling with .env.example, and the CI workflow.
The app must boot with an empty shell and the server must start and connect to MongoDB. Add a smoke
test. Then run lint, typecheck, build and report results. Keep secrets out of the repo.
```

**Gate:** `npm run build` passes across workspaces, lint + typecheck clean, server boots and connects,
empty desktop window launches, CI is green on the branch.

---

### Phase 1 - Design system and UX

**Goal:** the visual language and a component library the engineers will build every screen from.

**Plan prompt**
```
Use the ui-ux-designer subagent. Read CLAUDE.md and the needs doc (UI/UX section). Plan the CSense
design system: the design-token set (colour incl. the semantic blue/green/amber/red, type scale,
spacing, radius, elevation, motion), the component inventory needed for all screens, and
wireframes for: security gate, login, onboarding, module player, quiz, employee dashboard, admin
dashboard. State the accessibility targets (WCAG 2.1 AA). List the files. Do not build business logic.
```

**Build prompt**
```
Implement the approved design system with the ui-ux-designer subagent: dark-mode-first tokens as the
single source of truth the React app consumes, the accessible themeable component library, and
high-fidelity screen skeletons with placeholder data and typed props/callbacks for the engineers to
wire later. Add a /styleguide route or Storybook preview and a short guide in docs/design/. Verify
contrast and keyboard navigation. No data fetching, no auth logic.
```

**Gate:** styleguide/Storybook renders every core component in dark and light mode, tokens are
consumed (no hardcoded colours in components), a quick axe/contrast check passes, screens are
visually reviewable.

---

### Phase 2 - Backend foundation: auth and security

**Goal:** identity done right. This is the security spine of the whole app, so it gets an independent
security review before it is accepted.

**Plan prompt**
```
Use the architect subagent. Plan Phase 2: authentication and the server security baseline for CSense.
Cover the User model with role (employee/administrator), admin-only account creation (no self-
registration), JWT access + rotating refresh tokens, bcrypt hashing, RBAC deny-by-default middleware,
helmet, rate limiting, and zod validation. Define the auth routes and their authz levels, the token
lifetimes and storage approach, and the error model that avoids user enumeration. List files and the
exact tests (including authz-denial and token-expiry cases). Note anything ambiguous.
```

**Build prompt**
```
Implement the approved Phase 2 plan with the backend-engineer subagent, following the CLAUDE.md
security baseline exactly. Build auth (login, refresh, logout, admin-create-user), bcrypt>=12, the
RBAC middleware, helmet, rate limiting, zod validation on every input, and the audit-log scaffold.
Write unit + supertest integration tests covering happy path, validation failures, employee-hits-
admin-route denials, and token expiry/refresh. Update .env.example. Run lint, typecheck, tests.
```

**Independent review (do not skip):**
```
Use the security-tester subagent to review the Phase 2 auth diff as an attacker. Verify self-
registration is impossible, RBAC is enforced server-side everywhere, tokens are handled and stored
safely with no secrets in the payload, there is no user enumeration, and inputs are validated. Add
automated authz/IDOR tests. Report findings by severity with repros and fixes. Do not change product
code without my sign-off.
```

**Gate:** auth integration tests green, security-tester reports no High/Critical open, `/verify`
passes.

---

### Phase 3 - Learning engine

**Goal:** modules, sequential unlocking, quizzes, final assessment, grading.

**Plan prompt**
```
Use the architect subagent. Plan the learning engine from the needs doc and class diagram: Module
(with unique order, content/video, publish state), sequential unlock rules, UserProgress, the
Assessment -> Quiz/FinalTest/Question model, QuizAttempt, and grading with a per-module configurable
passing threshold (default 70%; confirm against open questions). Define the endpoints, the unlock
invariant ("module N+1 unlocks only when N's quiz is passed"), and the tests that prove it. List files.
```

**Build prompt**
```
Implement the approved learning engine with the backend-engineer subagent, then wire the minimal
module/quiz API into the player and quiz UI with the frontend-engineer subagent using the Phase 1
components. Enforce the unlock invariant server-side (never trust the client). Record attempts, scores,
and pass/fail. Cover unlock, grading, retry, and tamper attempts (client claiming a pass) with tests.
Run the gate.
```

**Gate:** e2e test shows a locked module, a passed quiz, the next module unlocking, and a failed quiz
blocking progress; server rejects a forged pass; `/verify` green.

---

### Phase 4 - Gamification and risk engine

**Goal:** XP, five-tier levels, badges, the weighted risk profile, and governance escalation.

**Plan prompt**
```
Use the architect subagent. Plan gamification and the risk engine. Levels: Apprentice, Aware,
Practitioner, Guardian, Defender, driven by XP thresholds (put thresholds in shared/). Badges awarded
on module completion. Risk profile = Knowledge 30% + Behavioural 25% + Simulation 30% + Engagement
15%, classified Low/Medium/High -> Green/Amber/Red. Define how each sub-score is sourced, the
escalation workflow (elevated risk notifies the security team; critical events are audit-logged and
escalated), and the exact unit tests for the weights and bands. Keep risk logic pure and in shared/.
```

**Build prompt**
```
Implement the approved plan with the backend-engineer subagent. Put the risk computation and level
thresholds in shared/ as pure, fully unit-tested functions (assert the 30/25/30/15 weights and each
band boundary). Award XP and badges on the right events, compute and persist RiskProfile, and
implement the governance escalation with immutable audit-log entries. Add tests for escalation
triggers. Run the gate.
```

**Gate:** risk-engine unit tests assert exact weights and band boundaries; completing a module awards
XP + badge; a crafted high-risk profile produces an escalation and an audit record; `/verify` green.

---

### Phase 5 - Desktop shell and security gate

**Goal:** the Electron behaviours that make CSense an enforcement tool, not a website: the start-up
security gate and the quiz kiosk lockdown.

**Plan prompt**
```
Use the architect subagent. Plan the Electron layer: main process, a minimal typed preload bridge
(contextIsolation on, nodeIntegration off), the pre-access security gate that intercepts at launch
and blocks access until the required interaction completes (limited retries, then a restricted-access
state that notifies the security team), kiosk/lockdown mode for active quizzes (restrict shortcuts,
clipboard, devtools, focus loss), native OS notifications for reminders, and secure token storage via
preload. Define how the renderer requests and exits lockdown. List the security properties the
security-tester will later try to break.
```

**Build prompt**
```
Implement the approved Electron layer with the frontend-engineer subagent. Build the security gate,
the quiz kiosk lockdown (enforced in the main process), the secure preload-bridged token store, and
native notifications. Add Playwright e2e for: gate blocks then grants access, retry exhaustion ->
restricted state, and lockdown active during a quiz. Keep the preload surface minimal and typed.
Run the gate.
```

**Gate:** app launches into the gate and refuses access until the interaction is done; retry
exhaustion produces the restricted state; quiz lockdown is active and the obvious escapes fail;
`/verify` green.

---

### Phase 6 - Employee experience

**Goal:** the full employee journey, end to end and polished.

**Plan prompt**
```
Use the architect subagent. Plan the complete employee experience against the needs doc: onboarding/
welcome, the module player (video + interactive with immediate feedback), the quiz flow, the progress
dashboard (modules, scores, XP, level, badges), and the final assessment entry. Identify every API
call and the Phase 1 components reused. Define the e2e journey test.
```

**Build prompt**
```
Implement the approved employee experience with the frontend-engineer subagent, reusing the Phase 1
design system and the Phase 3/4 APIs. Wire real data, loading/empty/error states, and immediate quiz
feedback. Make the whole journey (first login -> onboarding -> modules -> quizzes -> dashboard ->
final assessment) work and feel coherent. Add the end-to-end journey test. Run the gate.
```

**Gate:** a seeded employee can complete the entire journey in the running app; dashboard reflects
real XP/level/badges; e2e journey test green; `/verify` green.

---

### Phase 7 - Admin console

**Goal:** the security team's cockpit.

**Plan prompt**
```
Use the architect subagent. Plan the administrator console from the needs doc: overview KPIs, the
employee-progress table, per-module completion breakdown, risk profiles and scoreboard, badges, user
management (create/edit/deactivate, assign modules), content management (modules + final test), report
generation, and phishing-campaign configuration behind a feature flag (confirm scope). Define the
admin-only routes, the authz tests, and the data each view needs.
```

**Build prompt**
```
Implement the approved admin console. Use the backend-engineer subagent for admin routes, reporting,
and content CRUD (all admin-RBAC, all validated), and the frontend-engineer subagent for the console
UI on the Phase 1 design system. Put phishing-campaign config behind the feature flag. Add integration
tests for admin CRUD and report generation, and authz tests proving employees cannot reach any of it.
Run the gate.
```

**Gate:** admin can create a user, edit content, and generate a report; an employee token is denied on
every admin route (tested); phishing config hidden when the flag is off; `/verify` green.

---

### Phase 8 - Testing and QA

**Goal:** turn scattered tests into a trustworthy suite with real coverage.

**Build prompt**
```
Use the test-engineer subagent. Audit current coverage and raise it to the thresholds in config.
Fill gaps: unit tests for all shared logic (risk engine, unlock, grading), supertest integration for
every route including validation and authz-denial paths, and Playwright e2e for the critical journeys
(gate grant/deny, module unlock, quiz pass/fail/retry, admin creates user, risk escalation surfaces to
admin). Add deterministic fixtures/factories and ensure isolated, repeatable runs. Report final
coverage and any remaining untested critical path. Hand real defects to the debugger - do not quietly
change product code.
```

**Gate:** coverage thresholds met, full suite green locally and in CI, the critical-path list is fully
covered.

---

### Phase 9 - Security testing and hardening

**Goal:** an adversarial pass over the whole system and a compliance checklist.

**Build prompt**
```
Use the security-tester subagent for a full assessment of CSense. Test authn/authz and IDOR across
employee and admin (one employee must never read another's progress or risk profile), token handling,
input validation and NoSQL injection, Electron hardening, and active attempts to break out of the
security gate and the quiz kiosk lockdown (shortcuts, clipboard, devtools, focus). Run npm audit,
semgrep, and secret scanning. Produce a findings report ranked by severity with a repro and a
remediation for each, add automated regression tests for every finding, and map controls to ISO/IEC
27001:2022, NIST SP 800-50, and CIS v8 Control 14 in a checklist. Propose fixes; apply them only after
I approve each.
```

**Gate:** no High/Critical findings left open, each fixed finding has a regression test, the
compliance checklist is complete, `npm audit` clean at high.

---

### Phase 10 - Debug, polish, and deployment

**Goal:** fix what the last two phases surfaced, then ship it live.

**Debug/polish prompt**
```
Use the debugger subagent to work through the open findings and any flaky tests from Phases 8 and 9.
For each: reproduce, isolate the root cause, fix minimally without weakening security, and add a
regression test. Then do a performance and UX polish pass on the critical journeys. Report what
changed and any residual risk.
```

**Deploy prompt**
```
Use the devops-deployer subagent to take CSense live. Finalise GitHub Actions (lint, typecheck, test,
build, audit, block on failure). Package signed desktop installers with electron-builder (Windows
first). Containerise and deploy the API to a managed Node host with MongoDB Atlas (backups on) and a
health check; serve module media via a CDN. Manage all secrets via CI/platform secret stores. Write a
release runbook and a rollback procedure in docs/ops/. A deploy counts as done only when a smoke test
against the live backend and a fresh installer launch both pass. Report the release artifacts and URLs.
```

**Gate:** CI green on main, a signed installer launches and reaches the live backend, backend health
check and smoke tests pass, runbook and rollback documented. CSense is live.

---

## Quick reference

- **Start a phase:** `/clear` -> `Shift+Tab` (plan mode) -> paste Plan prompt -> approve -> branch ->
  paste Build prompt.
- **Finish a phase:** `/verify` -> manual check -> (security-tester review if sensitive) ->
  `/ship-phase NN name` -> commit + PR yourself.
- **Something broke:** hand it to the `debugger`. **Security doubt:** hand it to the `security-tester`.
- **Keep CLAUDE.md honest.** It is the one memory every agent shares.

Build in this order, hold every gate, and keep each diff small. That is how the whole thing gets to
live without turning into a debugging swamp at the end.
