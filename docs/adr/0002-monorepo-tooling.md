# ADR 0002: Monorepo tooling

- Status: Accepted (Phase 0 plan approved 2026-10-24)
- Date: 2026-10-24
- Deciders: Technical architect, devops, product owner

## Context
CSense has three TypeScript packages: desktop (Electron + React), server (Express), and shared
(types, constants, pure domain logic) that both depend on. Development happens on Windows, in a path
that contains a space; CI runs on GitHub Actions; Electron packaging with electron-builder comes in
Phase 10. CLAUDE.md commands already use `npm run ...` and the Definition of Done requires a clean
`npm audit` at high. We need one install, one lockfile, cross-package type safety, and a single set
of lint/format/test commands, with as little tooling as possible.

## Decision
- Package manager: npm workspaces (npm bundled with Node 24 LTS), one root `package-lock.json`,
  packages `@csense/shared`, `@csense/server`, `@csense/desktop`. `engine-strict` with Node pinned via
  `.nvmrc`.
  - Rejected pnpm: faster and stricter, but its symlinked `node_modules` needs `node-linker=hoisted`
    and workarounds for Electron/electron-builder, symlinks are less reliable on Windows, and it adds
    a tool every contributor and CI image must install.
  - Rejected Yarn Berry (PnP): poor compatibility with Electron tooling.
  - Rejected Turborepo/Nx: three packages do not justify a task orchestrator; TypeScript project
    references and ordered npm scripts are enough. Revisit if build times hurt.
- TypeScript: `tsconfig.base.json` with strict options; each package is a composite project; a root
  solution `tsconfig.json` references all of them; `npm run typecheck` = `tsc -b`. Shared builds to
  `dist` with declarations and is consumed through package `exports`; the desktop renderer aliases
  shared source for hot reload.
- Module system: ESM everywhere (`"type": "module"`), with electron-vite emitting the formats Electron
  requires (CommonJS preload when sandboxed).
- Lint/format: ESLint flat config (`eslint.config.mjs`) with typescript-eslint type-checked rules,
  React/hooks/jsx-a11y for the renderer, and eslint-config-prettier; Prettier for formatting; LF line
  endings enforced through `.gitattributes`, `.editorconfig` and Prettier.
- Tests: one root `vitest.config.ts` using `test.projects` (the replacement for the deprecated
  workspace file); Playwright Electron e2e in `desktop/`.
- Environment: a single root `.env` / `.env.example`. The server validates it with zod at startup;
  electron-vite reads it with `envDir: '..'` and exposes only `MAIN_VITE_*` / `RENDERER_VITE_*` keys.
- CI: GitHub Actions running format check, lint, typecheck, test, build, and `npm audit
  --audit-level=high` on Ubuntu, plus an Electron smoke test on Windows.

## Consequences
- Positive: zero extra tooling to install; one lockfile for audit; commands match CLAUDE.md;
  type errors across package boundaries are caught by `tsc -b`; electron-builder works with the
  hoisted layout.
- Negative: npm workspaces have no task graph or caching, so build order is encoded in the root
  `build` script and must be kept correct by hand; hoisting can hide undeclared dependencies
  ("phantom deps"), so lint rules (`import/no-extraneous-dependencies` or equivalent) and code review
  must catch them; shared must be built before the server runs in dev (handled by `predev` and a
  watch task).
- Follow-ups: add per-package coverage thresholds in Phase 8; pin GitHub Actions to commit SHAs in
  Phase 10.
