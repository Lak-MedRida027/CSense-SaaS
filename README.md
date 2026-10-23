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
