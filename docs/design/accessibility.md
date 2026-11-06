# Accessibility

Target: **WCAG 2.1 AA** in both themes. Accessibility is not optional; trade-offs are recorded below.

## How it is enforced
| Check | Where | Runs in |
|---|---|---|
| Token contrast (text, borders, focus, status, chips, solids, levels, brand) | `design/tokens/tokens.test.ts` | `npm test` |
| Hue separation (levels vs status) | `tokens.test.ts` | `npm test` |
| No hardcoded colours in UI code | ESLint `no-restricted-syntax` + `design/noColourLiterals.test.ts` | `npm run lint`, `npm test` |
| jsx-a11y rules | `eslint.config.mjs` | `npm run lint` |
| axe (WCAG A/AA, contrast off in jsdom) per component | `components/*/*.test.tsx` | `npm test` |
| axe on every screen fixture in dark and light | `screens/screens.a11y.test.tsx` | `npm test` |
| axe **with colour contrast** in real Chromium, styleguide + all screens, dark and light; keyboard and reduced-motion checks | `desktop/e2e/styleguide.a11y.spec.ts` | `npm run test:a11y -w @csense/desktop`; CI e2e job |

The Chromium spec skips against a normal production build (no styleguide in it). CI runs it as its
own step with `CSENSE_REQUIRE_STYLEGUIDE=1`, which turns that skip into a failure.

## Patterns
- **Keyboard:** everything reachable and operable; visible 2px focus ring with offset; skip links in
  `AppShell` and the module player; dialogs trap focus and return it; Tabs and BadgeGrid use roving
  tabindex; the video player takes Space/K, arrows, M and C when focused.
- **Targets:** 44px minimum (`--cs-size-target-min`); `sm` controls expand their hit area.
- **Names and roles:** native elements first (button, input, select, table, fieldset). ARIA only
  where native semantics do not exist (switch, tabs, progressbar, alertdialog, live regions).
- **Status:** icon shape + text + colour, always. Charts print values and offer a table view.
- **Announcements:** polite live regions for attempts, Caps Lock, search counts and toasts;
  `role="alert"` only for critical. Focus moves to new headings when a view changes (gate states,
  feedback, results).
- **Motion:** OS `prefers-reduced-motion` plus an in-app override; durations collapse, transforms are
  neutralised, shimmer and celebrations stop. Nothing loops except spinners, which stop after one
  turn under reduced motion and always carry text.
- **Media:** captions track supported and the control says when captions are missing; transcript
  panel; no autoplay.
- **Time limits:** toasts last at least 6s and pause on hover/focus; gate auto-continue is optional
  and always has a "Continue now" button. No quiz timer.
- **Text size:** rem-based scale with Default / Large (112.5%) / Larger (125%).

## Recorded trade-offs
1. `text-disabled` is below 4.5:1. WCAG 1.4.3 exempts inactive components, and every disabled or
   locked control has adjacent text explaining why.
2. `sm` buttons are 32px visually with a 44px hit area; inline text links are exempt from target size.
3. Progress tracks are about 1.4:1 against the surface. They are decorative and every bar prints its
   value.
4. Quiz lockdown deliberately blocks Escape and shortcuts. The always-visible "Exit quiz" button
   keeps WCAG 2.1.2 (no keyboard trap) satisfied.
5. Level hues sit 26-27 degrees from the nearest status hue (Aware vs success, Practitioner vs info);
   numerals and pip crests carry the meaning.
6. Radio option descriptions are part of the option's accessible name (kept for context); checkbox
   descriptions are linked with `aria-describedby` instead.
7. Programmatic focus targets (result and feedback headings) have no visible ring because they are
   not interactive; their content is announced on focus.
8. `VideoPlayerFrame` treats `captionsSrc` as optional, so `jsx-a11y/media-has-caption` is disabled
   there and nothing yet enforces WCAG 1.2.2. Open follow-up for the module phase: require a
   captions track for every video module in the content model.

## Manual checks before a release
- Run NVDA (Windows) through gate -> login -> onboarding -> module -> quiz -> result.
- Windows High Contrast / forced colours: confirm focus rings and borders stay visible.
- 200% zoom at 1280x800: no clipped text or lost actions.
