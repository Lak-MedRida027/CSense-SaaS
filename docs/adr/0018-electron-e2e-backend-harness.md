# ADR 0018: Electron e2e backend harness

- Status: Accepted 2026-11-10 (Phase 5 plan section 12.4, decision D5-27)
- Date: 2026-11-10
- Deciders: Technical architect, devops (review)

## Context
The Phase 5 playbook gate needs Playwright Electron e2e against a real API. The cases are: the gate blocks and then grants access, retry exhaustion leads to the restricted state, and lockdown holds during a quiz. The CI e2e job runs on `windows-latest`, which has no MongoDB service containers. The server tests already use `mongodb-memory-server`, a server dev dependency. Playwright runs `globalSetup` in the runner process and specs in workers. The server is ESM with NodeNext `.js` imports and builds to `server/dist`.

## Decision
1. **A test-only server entry `server/src/testing/e2eServer.ts`**, compiled by a separate project (`server/tsconfig.e2e.json`, script `npm run build:e2e -w @csense/server`) and excluded from the production build (`npm run build`, `server/tsconfig.json`). It lands at the same path, `server/dist/src/testing/e2eServer.js`. The root `tsc -b` (typecheck) builds both projects.
   - It refuses to run unless `NODE_ENV=test` and `CSENSE_E2E_HARNESS=1`.
   - It dynamically imports `mongodb-memory-server`.
   - It ensures indexes and seeds learning, badge and gate content plus fixed accounts (admins, `gate-pass@`, `gate-fail@`, `quiz@` with module 1 content completed).
   - It generates per-run secrets and starts `createApp` on `127.0.0.1:0`.
   - It prints one ready line of JSON (base URL, accounts, gate answer key by prompt) and exits on SIGTERM or stdin close.
2. **Playwright `globalSetup`** spawns it as a child process from the built dist (after `npm run build:e2e -w @csense/server`), waits up to 90 s, and writes `desktop/e2e/.run/backend.json` (gitignored). `globalTeardown` kills it.
   - The separate process keeps the server's Mongoose singleton and the audit configuration out of the Playwright runner.
3. **Each spec launches the unpackaged app** with `CSENSE_API_BASE_URL`, a fresh `CSENSE_USER_DATA_DIR`, a short gate poll interval and devtools disabled. These overrides are honoured only when unpackaged (ADR 0013).
4. **CI:** the e2e job gets `NODE_ENV=test`, a cached `MONGOMS_DOWNLOAD_DIR` on Windows, and a 30-minute timeout.

## Consequences
- Positive: real end-to-end coverage of gate, restriction and lockdown on the target OS, with no external services. It is deterministic (fixed seed, per-run database). It reuses the server's own seeds and `createApp`.
- Negative:
  - The production build no longer contains the harness (P5-I6); the e2e job must run `build:e2e` (or the root `tsc -b`) before the specs. It is still guarded by two environment variables and imports a dev dependency that is absent in production installs.
  - The first Windows run downloads a MongoDB binary (cached afterwards).
  - The ready-line protocol is simple but bespoke.
