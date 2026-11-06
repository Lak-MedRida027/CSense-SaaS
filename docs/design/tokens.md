# Design tokens

Source: `desktop/src/renderer/src/design/tokens/*.ts`. Generated CSS:
`tokens.generated.css` (do not edit; regenerate with `npx vitest -u`). Every CSS variable is
prefixed `--cs-`.

## Colour

### Surfaces, text, borders

| Role | CSS variable | Dark (primary) | Light |
|---|---|---|---|
| Canvas (app background) | `--cs-color-surface-canvas` | `#0B0F17` | `#F6F8FB` |
| Surface 1 (cards) | `--cs-color-surface-s1` | `#121826` | `#FFFFFF` |
| Surface 2 (raised, inputs) | `--cs-color-surface-s2` | `#1A2233` | `#EEF2F7` |
| Surface 3 (popover, hover) | `--cs-color-surface-s3` | `#232C3F` | `#E3E8F0` |
| Text primary | `--cs-color-text-primary` | `#E6EDF3` | `#0F172A` |
| Text secondary | `--cs-color-text-secondary` | `#A9B4C4` | `#3E4A5E` |
| Text muted | `--cs-color-text-muted` | `#8B97AB` | `#556274` |
| Text disabled (exempt) | `--cs-color-text-disabled` | `#5C677A` | `#8A94A6` |
| Border subtle (dividers) | `--cs-color-border-subtle` | `#2A3447` | `#DCE2EA` |
| Border strong (controls) | `--cs-color-border-strong` | `#6E7B94` | `#6F7B90` |
| Focus ring | `--cs-color-focus-ring` | `#9DB7FF` | `#2B4FD8` |
| Scrim | `--cs-color-scrim` | `rgba(4,6,10,.72)` | `rgba(15,23,42,.48)` |

### Status (locked semantics)
Each tone has `fg`, `subtle-bg`, `subtle-fg`, `solid`, `on-solid`:
`--cs-color-status-{info|success|caution|critical}-{fg|subtle-bg|subtle-fg|solid|on-solid}`.

| Tone | Meaning | Icon | Dark fg | Light fg |
|---|---|---|---|---|
| info | information, secure mode | Info (circle-i) | `#5AA9FF` | `#1F63C7` |
| success | correct, completed, low risk | CircleCheck | `#3FCB7E` | `#11704A` |
| caution | warning, last attempt, medium risk | TriangleAlert | `#F5B83D` | `#8A5A00` |
| critical | error, restricted, high risk | OctagonAlert | `#FF6B6B` | `#C2272D` |

### Risk bands
Aliases of the status set (`--cs-color-risk-low-fg: var(--cs-color-status-success-fg)` and so on).

| Band | Governance | Tone | Icon | Label |
|---|---|---|---|---|
| Low | Green | success | ShieldCheck | "Low risk" |
| Medium | Amber | caution | TriangleAlert | "Medium risk" |
| High | Red | critical | OctagonAlert | "High risk" |

### Levels
`--cs-color-level-{name}-{fg|subtle-bg}`. Always shown with the numeral (L1 to L5) and a pip crest.

| Level | Dark fg | Light fg | OKLCH hue | Crest |
|---|---|---|---|---|
| L1 Apprentice | `#A3B1C6` slate | `#55657D` | neutral | 1 pip |
| L2 Aware | `#2DD4BF` teal | `#0B7366` | 182 | 2 pips |
| L3 Practitioner | `#8B93FF` indigo | `#4F56D6` | 278 | 3 pips |
| L4 Guardian | `#B98AF8` violet | `#7D45C9` | 302 | 4 pips |
| L5 Defender | `#E879D9` fuchsia | `#A8338F` | 332 | 5 pips + star |

Status hues (OKLCH): info 252, success 155, caution 81, critical 23. Level hues are kept at least
25 degrees away (tested). Defender is fuchsia, not gold, so it never reads as caution (D10).

### Brand (neutral default)
`--cs-color-brand-{primary|primary-hover|on-primary|subtle}` and `--cs-color-brand-accent`.
Neutral CSense is monochrome: dark `#E6EDF3` on `#0B0F17`, light `#0F172A` with white text.
See [brand.md](brand.md).

### Contextual hooks
Set an attribute, read local variables:
- `data-tone="info|success|caution|critical|neutral"` and `data-risk="Low|Medium|High"` expose
  `--cs-tone-fg`, `--cs-tone-subtle-bg`, `--cs-tone-subtle-fg`, `--cs-tone-solid`, `--cs-tone-on-solid`.
- `data-level="Apprentice|...|Defender"` exposes `--cs-level-fg`, `--cs-level-subtle-bg`.

## Contrast matrix (verified by `tokens.test.ts`)
Ratios are the minimum across canvas, s1, s2 and s3 unless stated.

| Pair | Dark | Light | Target |
|---|---|---|---|
| text-primary | 11.82 | 14.51 | 4.5 |
| text-secondary | 6.66 | 7.28 | 4.5 |
| text-muted | 4.73 | 5.04 | 4.5 |
| border-strong | 3.27 | 3.47 | 3.0 |
| focus-ring | 7.08 | 5.31 | 3.0 |
| info fg | 5.69 | 4.65 | 4.5 |
| success fg | 6.69 | 4.96 | 4.5 |
| caution fg | 7.85 | 4.82 | 4.5 |
| critical fg | 5.03 | 4.71 | 4.5 |
| chips (subtle-fg on subtle-bg) | 7.89 to 9.75 | 5.72 to 6.70 | 4.5 |
| solid fills (on-solid on solid) | 4.74 to 10.44 | 4.74 to 10.44 | 4.5 |
| level fg (lowest: Practitioner/Aware) | 5.13 | 4.67 | 4.5 |
| primary button (on-primary) | 16.23 | 17.85 | 4.5 |

## Typography
- `--cs-font-family-sans`: Inter Variable (bundled), then system-ui / Segoe UI.
- `--cs-font-family-mono`: JetBrains Mono (bundled), then Consolas.
- Scale (`--cs-font-size-*` / `--cs-line-height-*`): xs 12/16, sm 14/20, md 16/24 (body),
  lg 18/28, xl 20/28, 2xl 24/32, 3xl 30/38, 4xl 36/44, display 48/56. All in rem, so the
  text-size preference (`data-text-size="large|larger"`, 112.5% / 125%) scales everything.
- Weights: 400 / 500 / 600 / 700. Numbers use `tabular-nums`. Minimum body size 14px.

## Space, size, radius
- Space (4px grid): `--cs-space-0..12` = 0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80 px.
- Size: `--cs-size-target-min` 44px, controls sm 32 / md 44 / lg 52, table row 48, sidebar 248,
  content max 1200, reading max 72ch, focus ring 2px + 2px offset.
- Radius: none 0, sm 4 (chips), md 8 (inputs, buttons), lg 12 (cards), xl 16 (dialogs, gate), pill.

## Elevation and layers
- `--cs-shadow-e0..e4`. Dark mode gets depth mostly from surface steps + borders; light mode from
  shadow.
- `--cs-z-*`: base 0, sticky 100, dropdown 200, overlay 300, modal 400, toast 500,
  lockdown-banner 900.

## Motion
| Token | Value | Reduced | Use |
|---|---|---|---|
| `--cs-duration-fast` | 120ms | 120ms | colour/opacity only (hover, press) |
| `--cs-duration-base` | 200ms | ~0 | state changes, feedback reveal |
| `--cs-duration-slow` | 320ms | ~0 | panels, dialogs, toasts |
| `--cs-duration-deliberate` | 480ms | ~0 | progress/XP fills |
| `--cs-duration-celebrate` | 900ms | ~0 | badge unlock (one-off) |

Easings: standard `(.2,0,0,1)`, enter `(0,0,0,1)`, exit `(.3,0,1,1)`, emphasized `(.3,0,0,1.15)`
(celebrations only). `--cs-motion-press-scale` 0.98 and `--cs-motion-enter-distance` 8px become 1
and 0px under reduced motion. Reduced motion applies when the OS asks for it (unless the user picks
"full") or when the in-app preference is "reduced" (`data-motion="reduced"`).
