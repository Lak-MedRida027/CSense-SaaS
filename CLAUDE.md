# CSense - Project Guide for Claude Code

This file is auto-loaded into every Claude Code session. Keep it short, current, and true.

## What we are building
CSense is a **desktop cybersecurity awareness training platform** for an organisation's employees.
It intercepts the employee at workstation start-up with a **pre-access security gate**, then drives
them through sequentially locked learning modules (video + interactive), quizzes, a final assessment,
gamification (XP, levels, badges), a per-employee **risk profile**, and an admin/security-team console.

Authoritative requirements live in:
- `docs/CSense_Client_Needs.docx` (functional + non-functional needs, constraints, assumptions)
- `docs/CSense_UseCase_UML.png` (actors + use cases)
- `docs/CSense_Class_UML.png` (domain model: entities, attributes, relationships)

Read those before implementing any feature. If they disagree with this file, this file wins for
engineering decisions; the needs doc wins for product scope.

## Stack
- **Desktop shell + UI:** Electron + React + TypeScript, built with electron-vite
- **API:** Node.js + Express + TypeScript
- **DB:** MongoDB via Mongoose
- **Validation:** zod   **Auth:** JWT (access + refresh) + bcrypt   **Tests:** Vitest + Playwright
- **Shared logic** (risk scoring, constants, types) lives in `/shared` and is imported by both sides.

## Repo layout
```
csense/
  desktop/      Electron main + preload + React renderer
  server/       Express API, Mongoose models, routes, middleware
  shared/       risk model, level thresholds, shared TS types, constants
  docs/         requirements + UML + build prompts
  .claude/      agents + commands (this toolchain)
  CLAUDE.md
```

## Golden rules
1. One phase per git branch. Conventional Commits. Never commit to `main` directly.
2. Every feature ships with tests and must pass that phase's **gate** before the next phase starts.
3. Never weaken a security control to make a test pass. Fix the test or the design.
4. No secrets in code. Everything via `.env` (and `.env.example` is kept in sync).
5. If a requirement is ambiguous (see Open Questions), STOP and ask rather than guessing.
6. Prefer small, reviewable diffs. Explain non-obvious decisions in the PR description.

## Security baseline (non-negotiable)
- Access token ~15 min, refresh token ~7 days in an httpOnly store; rotate refresh on use.
- Passwords: bcrypt cost >= 12. No plaintext, ever.
- **No self-registration.** Employee and admin accounts are created by an administrator only.
- RBAC on every protected route (`employee` vs `administrator`); deny by default.
- `helmet`, `express-rate-limit`, server-side `zod` validation on every input.
- Quizzes run in a **kiosk/lockdown mode** (restrict shortcuts, clipboard, devtools while active).
- Every risk escalation writes an immutable **audit log** entry.

## Risk engine (fixed weights)
Composite risk = Knowledge 30% + Behavioural 25% + Simulation 30% + Engagement 15%.
Bands: Low = Green, Medium = Amber, High = Red. Keep this logic in `/shared` with unit tests.

## Definition of Done (per task)
`lint` clean, `typecheck` clean, unit + integration tests green, app builds, no high/critical
`npm audit` findings, docs/`.env.example` updated if surface changed.

## Common commands
- `npm run dev` (server + desktop)   `npm test`   `npm run typecheck`   `npm run lint`   `npm run build`

## Open questions (confirm with product owner before coding the affected part)
- Module count: design report says 6, implementation report says 7. Assume 7 until told otherwise.
- Quiz passing threshold: "3 of 5" vs "70%". Make it **configurable per module**; default 70%.
- Phishing simulation + continuous-review phase: in scope now, or behind a feature flag? Assume flag.
- Client identity (deploying org) for seed data and branding.
