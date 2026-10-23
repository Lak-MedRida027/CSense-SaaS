# ADR 0001: Technology stack

- Status: Accepted (Phase 0 plan approved 2026-10-24)
- Date: 2026-10-24
- Deciders: Product owner, technical architect

## Context
CSense is a desktop cybersecurity-awareness platform that must intercept employees at workstation
start-up (pre-access security gate), enforce a kiosk/lockdown mode during quizzes, deliver video and
interactive modules, and give administrators a console with risk profiles and auditable escalation
(Client Needs FR1-FR16; NFRs: desktop installer, native OS notifications, dark-mode-primary UI, CDN
media, managed cloud DB, ISO/IEC 27001:2022, NIST SP 800-50, CIS v8 Control 14). The team is
TypeScript-centric, develops on Windows, and wants shared business logic (risk scoring, level
thresholds, types) used by both client and server. CLAUDE.md fixes the stack at a high level; this
ADR records it and the supporting choices around it.

## Decision
- Desktop: Electron with a React + TypeScript renderer, built with electron-vite. Security defaults
  from day one: contextIsolation on, sandbox on, nodeIntegration off, strict CSP, a minimal typed
  preload bridge, navigation and window.open blocked. Kiosk/lockdown and the start-up gate are
  enforced in the main process (Phase 5), never only in the renderer.
- API: Node.js (24 LTS) + Express + TypeScript, ESM. helmet and a JSON body size limit from Phase 0;
  express-rate-limit and JWT auth from Phase 2.
- Database: MongoDB via Mongoose (MongoDB Atlas in production, local Docker or in-memory server in
  development/test). Class-diagram inheritance is mapped with Mongoose discriminators
  (User -> Employee/Administrator on `role`; Assessment -> Quiz/FinalTest on `kind`).
  Question answer keys are stored as an integer index into `options` (decided 2026-10-24).
- Validation: zod at every trust boundary (environment, request bodies/params/query), with shared
  schemas in /shared where both sides need them.
- Auth: JWT access token (~15 min) + rotating refresh token (~7 days) stored hashed server-side;
  bcrypt with cost >= 12 (the native `bcrypt` package with prebuilt binaries; `bcryptjs` is the
  fallback if Windows builds fail). No self-registration.
- Shared logic: a `/shared` TypeScript package for domain types, constants (roles, levels, fixed risk
  weights 30/25/30/15, bands) and, from Phase 4, pure risk/level functions.
- Testing: Vitest for unit/integration (supertest + mongodb-memory-server on the server, Testing
  Library + jsdom on the renderer); Playwright's Electron driver for end-to-end.
- Logging: pino (+ pino-http) with redaction of credentials and tokens. This is an addition not
  named in CLAUDE.md, chosen for structured logs that can be correlated with audit records.
- Packaging (Phase 10): electron-builder, Windows first, signed installers.

## Consequences
- Positive: one language end to end; risk logic is written once and unit-tested in one place;
  Electron gives the OS-level control (start-up launch, global shortcut capture, kiosk, native
  notifications) a web portal cannot; Mongoose discriminators let us keep the UML's inheritance
  without extra collections.
- Negative: Electron has a large install footprint and a big attack surface, so hardening must be
  maintained and reviewed (Phase 9). Lockdown in Electron is best-effort: it cannot fully stop
  OS-level escapes such as Ctrl+Alt+Del, so the residual risk must be documented. MongoDB's flexible
  schema needs strict Mongoose schemas (`strict: 'throw'`) and zod validation to avoid drift and
  NoSQL injection. Discriminators make TypeScript typing of models somewhat more verbose.
  Index-based answer keys mean any reordering of options must remap the stored index.
- Follow-ups: ADR for refresh-token transport in the desktop client (Phase 2/5); ADR for the
  feature-flag mechanism if it grows beyond environment variables.
