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

The API refuses to start until `JWT_ACCESS_SECRET` and `REFRESH_TOKEN_SECRET` are set in `.env`
(each base64url, at least 43 characters with at least 16 distinct ones, and different). `.env.example` shows how to generate them.

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
