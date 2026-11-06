# CSense design system

Enterprise-grade but approachable, **dark-mode first**, accessible by default (WCAG 2.1 AA).

| Doc | What it covers |
|---|---|
| [tokens.md](tokens.md) | Colour, type, spacing, radius, elevation, motion, and the contrast matrix |
| [components.md](components.md) | Component inventory, state matrices and accessibility notes |
| [screens.md](screens.md) | Wireframes and interaction notes for the seven core screens |
| [brand.md](brand.md) | What a client brand may override, and the guardrails |
| [accessibility.md](accessibility.md) | Targets, how we test, and recorded trade-offs |
| [ADR 0003](../adr/0003-design-tokens.md) | Why tokens are TS-generated CSS variables and CSS Modules |

## See it
- `npm run dev`, then open the app window and set the hash: `#/styleguide` (tokens),
  `#/styleguide/components` (every component state), `#/styleguide/screens` (every screen fixture).
  A toolbar toggles light theme and reduced motion. Dev builds only.
- `npm run test:a11y -w @csense/desktop` builds the styleguide and runs axe in both themes.

## Principles
1. **Status is never colour alone.** Every status, risk band, level and right/wrong state has an
   icon with a distinct shape and a text label (visible or screen-reader only).
2. **Semantic colour is locked.** Blue = info, green = success, amber = caution, red = critical.
   Risk: Low = green, Medium = amber, High = red. A brand can never recolour these.
3. **One primary action per view.** Progressive disclosure: details behind "View as table",
   expandable rows, collapsible takeaways.
4. **Immediate feedback.** Every interaction responds within 120ms (hover, press, selection) and
   exercises show right/wrong with an explanation straight away.
5. **Purposeful motion only**, and it collapses under reduced motion.
6. **Presentational components.** No data fetching, auth or IPC. Data comes in as typed props,
   actions go out through `on*` callbacks (the engineering seams).

## Using tokens
```css
.thing {
  padding: var(--cs-space-5);
  border-radius: var(--cs-radius-lg);
  background: var(--cs-color-surface-s1);
  color: var(--cs-color-text-primary);
  transition: background-color var(--cs-duration-fast) var(--cs-easing-standard);
}
/* Tone/level/risk-aware styles: set data-tone / data-level / data-risk on the element and read
   --cs-tone-fg, --cs-tone-subtle-bg, --cs-level-fg ... */
.chip { color: var(--cs-tone-subtle-fg); background: var(--cs-tone-subtle-bg); }
```
- Never write hex/rgb in components, screens or layouts (lint and a test enforce it).
- In TS, use `theme` from `design/tokens` only when a raw value is unavoidable; prefer `cssVar(...)`.
- After editing a token: `npx vitest run -u --project desktop src/renderer/src/design` to regenerate
  `tokens.generated.css`, then check the contrast tests are green.

## Do / don't
| Do | Don't |
|---|---|
| Pair colour with icon + text | Use red/green alone to mean fail/pass |
| Keep locked items visible with the unlock rule | Hide locked modules |
| Use `softDisabled` when the user needs to know why | Disable silently |
| Put explanations next to feedback | Make users hunt for why an answer was wrong |
| Use `Button size="sm"` (32px, 44px hit area) in dense tables | Shrink hit areas below 44px |
| Respect `useReducedMotion()` in JS animation | Loop or autoplay animations |
