# CSense

Desktop cybersecurity awareness training platform: a pre-access security gate, sequentially locked
learning modules, quizzes, gamification, per-employee risk profiles and an admin console.
See `CLAUDE.md` for the project guide and `docs/` for requirements, ADRs, the data model and the
API contract.

## Repo layout
```
desktop/   Electron main + preload + React renderer (electron-vite)
server/    Express API, Mongoose models
shared/    Shared types and constants (roles, levels, risk weights)
docs/      Requirements, UML, ADRs (docs/adr), data model, API contract
```

## Prerequisites
- Node.js 24 LTS (see `.nvmrc`; npm 11 ships with it)
- Docker Desktop (for the local MongoDB) or any MongoDB 8 you can reach

## Setup
```bash
npm ci
cp .env.example .env        # then edit values; never commit .env
docker compose up -d        # local MongoDB on 127.0.0.1:27017 (single-node replica set)
npm run dev                 # shared (watch) + API on :4000 + Electron window
```
Check the API: `curl http://localhost:4000/api/v1/health/ready` returns `{"status":"ready"}`.

The API refuses to start until `JWT_ACCESS_SECRET`, `REFRESH_TOKEN_SECRET` and `AUDIT_CHAIN_SECRET` are set in `.env`
(each base64url, at least 43 characters with at least 16 distinct ones, and all different). The API removes them from its process environment after reading them. `.env.example` shows how to generate them.

## First administrator
Accounts are created by administrators only, so the very first one is created from a shell
(decision U20). It is not available over HTTP.
```bash
# 1. In .env set BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_PASSWORD
#    (password: at least 12 characters, at most 72 bytes)
npm run bootstrap:admin:dev -w @csense/server     # from source
# or, after `npm run build`:  npm run bootstrap:admin -w @csense/server
# 2. Remove BOOTSTRAP_ADMIN_PASSWORD from .env afterwards.
```
The command is idempotent: if any administrator already exists it logs that and exits without
changing anything. It never generates or prints a password, and it writes a critical
`admin.bootstrapped` audit entry. Further accounts are created with `POST /api/v1/admin/users`.

## Seed the learning content (development and tests only)
Seven placeholder modules, seven quiz pools of twenty questions (a session serves five) and a final-test
pool of sixty (a session serves fifteen), with no client branding. There is deliberately no production build of this command. It fails closed:
- `NODE_ENV` must be set to `development` or `test` (unset or anything else is refused);
- a non-local MongoDB host is refused unless `SEED_ALLOW_REMOTE=true`;
- `--reset` (wipes learning content, progress and attempts) also needs `--confirm=<database name>`
  and writes a critical `learning.seed.reset` audit entry.

It is idempotent: existing items are kept untouched and only missing ones are created.
```bash
NODE_ENV=development npm run seed:learning:dev -w @csense/server
NODE_ENV=development npm run seed:learning:dev -w @csense/server -- --reset --confirm=csense
```
Session length is set with `ASSESSMENT_SESSION_TTL` (default `60m`, range 5m to 4h).

### Badges
`seed:learning:dev` also creates the seven development badges (one per module). To (re)run only that part:
```bash
NODE_ENV=development npm run seed:badges:dev -w @csense/server
```
It follows the same guards (development or test only, local MongoDB unless `SEED_ALLOW_REMOTE=true`), creates only
missing badges and keeps existing ones. `--reset` now also clears badges, awards, risk profiles, escalations and
employee XP (never the audit log), and needs `AUDIT_CHAIN_SECRET` because the reset is audited.

## Operations: reconcile and audit verification (Phase 4)
Both commands need the same `.env` as the API (`MONGODB_URI` and the three secrets) and are allowed in production.
```bash
# Rebuild XP, badges, risk profiles, escalations and missing audit entries from the attempt history.
npm run gamification:reconcile:dev -w @csense/server -- [--user <id>] [--dry-run] [--force-xp] [--reason model_upgrade|config_change]
# after `npm run build`:  npm run gamification:reconcile -w @csense/server -- ...

# Check the audit-log hash chain; prints JSON and exits 1 on a break (edit, deletion or reordering).
npm run audit:verify:dev -w @csense/server -- [--from=<seq>]
# after `npm run build`:  npm run audit:verify -w @csense/server
```
`gamification:reconcile` is idempotent. `--dry-run` writes nothing (not even audit entries) and exits 2 if it found drift;
`--force-xp` lets XP go down after a rule change (by default it only ever rises). A real run writes a
`maintenance.reconcile_run` audit entry. The API also runs a sweeper every `RECONCILE_SWEEP_INTERVAL` (default 5m,
`0` disables) that repairs employees marked after a failed hook and completes unaudited escalation events.

## What the gate and quiz lockdown cannot do (honest limits)

CSense is a user-space application. The pre-access gate is a **post-logon, pre-use** control, not a replacement for the
Windows logon, and the quiz lockdown is an anti-cheating aid, not a security boundary against a determined local user.
On Windows, Electron **cannot** block:

- the Windows logon itself (a pre-logon gate needs a native Credential Provider);
- Ctrl+Alt+Del and anything reachable from it (Task Manager, sign out, lock);
- Win+L, the Win key, Win+D, Win+Tab, Win+R, Win+V (clipboard history), Alt+Tab, Ctrl+Shift+Esc;
- killing the process (Task Manager, `taskkill`): the gate returns at the next logon, and the missing daily pass is
  visible server-side;
- capture at hypervisor or remote-desktop level, a second device, a phone camera, or another person.

What it does: starts at login (packaged builds), covers every display before any network call, refuses close and
Alt+F4 while locked (never OS logoff or shutdown), blocks the shortcut set in `docs/security/manual-lockdown-checklist.md`,
clears and blocks the clipboard, blacks out screenshots of the window during a quiz, and enforces a focus-loss policy.
Closing these gaps is **Phase 10 fleet policy** (machine-wide start, Assigned Access, `NoWinKeys`, `DisableTaskMgr`,
`AllowClipboardHistory=0`, AppLocker, a relaunch watchdog). See ADR 0015 and ADR 0016.

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` | Shared in watch mode, API with tsx watch, Electron with hot reload |
| `npm run build` | Builds shared, then server, then desktop |
| `npm run typecheck` | `tsc -b` across all project references |
| `npm run lint` | ESLint (flat config), zero warnings allowed |
| `npm run format` / `format:check` | Prettier |
| `npm test` | Vitest for all workspaces (server tests use an in-memory MongoDB) |
| `npm run test:e2e` | Playwright Electron smoke test (run `npm run build` first) |
| `npm run audit:high` | Fails on high/critical advisories |

## Windows notes
- The repo can live in a path with spaces; scripts quote paths.
- Line endings are LF everywhere (`.gitattributes`, `.editorconfig`, Prettier).
- The Electron binary and the test `mongod` binary download on first use, so npm needs no install
  scripts approved.

## Claude Code toolchain
`CLAUDE.md` is auto-loaded; `.claude/agents/` holds one subagent per role and
`.claude/commands/` holds `/verify` and `/ship-phase`. Follow `docs/BUILD_PLAYBOOK.md` phase by phase.
