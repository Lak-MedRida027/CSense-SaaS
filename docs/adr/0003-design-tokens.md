# ADR 0003: Design tokens and component styling

- Status: Accepted (Phase 1 plan approved 2026-10-24)
- Date: 2026-10-24
- Deciders: UI/UX designer, product owner

## Context
CSense needs one visual language (dark-mode primary, semantic blue/green/amber/red, five level
colours, three risk bands) consumed by an Electron + React renderer, with a light theme as a
secondary, a pluggable client brand, and WCAG 2.1 AA as a hard requirement. The renderer runs
offline under a strict CSP (`default-src 'self'`), so no CDN fonts or runtime CSS-in-JS that needs
`unsafe-eval`. The Electron main process also needs the canvas colour before first paint.

## Decision
- **Source of truth is TypeScript** in `desktop/src/renderer/src/design/tokens/`:
  primitives -> semantic roles (per theme) -> levels and risk -> type, space, size, radius,
  elevation, z-index, motion. Level and risk tokens are typed `Record<Level, ...>` /
  `Record<RiskLevel, ...>` against `@csense/shared`, so a new level or band fails typecheck until it
  has tokens. Tokens stay out of `shared/` because the server does not render UI; promote the palette
  only if server-side reports need colours.
- **CSS is generated from the TS.** `toCss(theme)` emits CSS custom properties (`--cs-*`), one block
  per theme (`:root[data-theme]`), risk aliases (`--cs-color-risk-*` -> status vars), contextual hooks
  (`[data-tone]`, `[data-risk]`, `[data-level]` -> `--cs-tone-*`, `--cs-level-*`) and reduced-motion
  overrides. The output is committed as `tokens.generated.css` and guarded by a Vitest
  `toMatchFileSnapshot`; `npx vitest -u` regenerates it. No build script and no new dependency.
- **Contrast is tested, not asserted in prose.** `tokens.test.ts` checks every text/surface,
  status, chip, solid and level pair in both themes against WCAG AA, and keeps level hues at least 25
  degrees (OKLCH) from every status hue.
- **Components use CSS Modules** (built into Vite) that reference only `var(--cs-*)`. Hex/rgb
  literals are banned in `components/`, `screens/` and `layouts/` by ESLint (TS/TSX) and by
  `noColourLiterals.test.ts` (CSS).
- **Runtime theming** is a `ThemeProvider` that sets `data-theme`, `data-motion` and
  `data-text-size` on `<html>` and writes validated brand variables inline. Dark is the default
  regardless of the OS (D13).
- **Brand** overrides are limited to app name, org name, logos and a primary/accent colour, all passed
  through `validateBrand()` guardrails (see `docs/design/brand.md`).
- **Preview** is a dev-only hash route (`#/styleguide`, `#/preview/...`), lazily imported only when
  `import.meta.env.DEV` or `--mode styleguide`, so production bundles do not contain it.
  Storybook was rejected (large dependency tree, `npm audit` exposure, a second build pipeline).
- **Fonts** Inter (variable) and JetBrains Mono are bundled as woff2 from the official Fontsource
  npm packages, OFL 1.1 licence shipped alongside (D14).
- **Icons** come from `lucide-react` (ISC), re-exported through `src/icons` to keep the set curated.

## Consequences
- Token edits require regenerating the snapshot; CI fails on drift.
- The Electron main process imports `design/tokens/electron.ts` (DOM-free) for its window background,
  so `desktop/tsconfig.node.json` includes that file and `primitives.ts`.
- `npm run test:a11y -w @csense/desktop` builds in styleguide mode and runs axe (including colour
  contrast) on every component and screen fixture in both themes. A plain `npm run build` restores the
  production bundle.
