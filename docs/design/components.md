# Components

All components live in `desktop/src/renderer/src/components/<Name>/` (`Name.tsx`,
`Name.module.css`, `Name.test.tsx`, `index.ts`) and are exported from `components/index.ts`. They are
presentational: data in through typed props, actions out through `on*` callbacks.

States: D default, H hover, F focus, X disabled, L loading, E empty, R error. A tick means the state
is implemented and shown in the styleguide gallery.

## Global rules
- Focus: `:focus-visible` 2px `--cs-color-focus-ring` with 2px offset (sits on the surface, at least
  7:1 dark / 5.3:1 light). Never removed on interactive elements.
- Targets: at least 44x44px. `sm` controls are 32px visually with an invisible 44px hit area.
- `aria-disabled` (`softDisabled`) when the user must discover why something is unavailable;
  native `disabled` otherwise.
- Tone, risk and level are never colour-only (icon shape + text).

## Primitives
| Component | D | H | F | X | L | E | R | Notes |
|---|---|---|---|---|---|---|---|---|
| Button (primary/secondary/ghost/danger, sm/md/lg) | ✓ | ✓ | ✓ | ✓ | ✓ | - | - | `type="button"` default. Loading: `aria-busy`, label kept (opacity 0), clicks ignored, width stable. `softDisabled` for focusable-disabled. |
| IconButton | ✓ | ✓ | ✓ | ✓ | ✓ | - | - | `label` required (aria-label + visual tooltip). Supports `aria-pressed`. |
| Link | ✓ | ✓ | ✓ | - | - | - | - | Always underlined. `external` adds icon, "(opens in browser)" and `rel="noopener noreferrer"`. |
| TextField | ✓ | ✓ | ✓ | ✓ | - | ✓ | ✓ | Visible label, hint and error linked by `aria-describedby`; `aria-invalid`; required marked in text. |
| PasswordField | ✓ | ✓ | ✓ | ✓ | - | - | ✓ | Show/hide with `aria-pressed`; Caps Lock warning in a polite live region. |
| Checkbox | ✓ | ✓ | ✓ | ✓ | - | - | ✓ | Native input; description outside the label (keeps the name short). |
| RadioGroup | ✓ | ✓ | ✓ | ✓ | - | - | ✓ | `fieldset`/`legend`; arrow keys native. |
| Select | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Native `<select>`; empty shows "No options available" and disables. |
| Switch | ✓ | ✓ | ✓ | ✓ | - | - | - | `role="switch"` + `aria-checked`; visible On/Off text. |
| Tooltip | ✓ | ✓ | ✓ | - | - | - | - | Hover + focus, Escape dismisses; `describe` (aria-describedby) or `visual` mode. |
| Spinner / Skeleton | ✓ | - | - | - | ✓ | - | - | Spinner is `role="status"` with text; Skeleton is `aria-hidden`; shimmer stops under reduced motion. |
| VisuallyHidden, FocusTrap, LiveRegion | utilities | | | | | | | FocusTrap wraps Tab and restores focus; LiveRegion keeps a mounted polite/assertive region. |

## Feedback and containers
| Component | D | H | F | X | L | E | R | Notes |
|---|---|---|---|---|---|---|---|---|
| Card | ✓ | ✓ | ✓ | - | ✓ | ✓ | ✓ | Region labelled by title. Clickable cards use the stretched-link pattern (`cardStyles.stretch`), never nested interactives. |
| Alert | ✓ | - | - | - | - | - | - | `role="alert"` for critical, `status` otherwise, `announce={false}` for static callouts. |
| Toast / ToastRegion | ✓ | ✓ | ✓ | - | - | - | - | Polite region; at least 6s, pauses on hover/focus; dismiss button. |
| Dialog | ✓ | - | ✓ | - | - | - | - | `aria-modal`, focus trap, Escape closes, focus returns. Scrim click does nothing (no accidental loss). |
| ConfirmDialog | ✓ | - | ✓ | - | ✓ | - | - | `alertdialog`; Cancel focused by default; danger tone for destructive confirms. |
| EmptyState | - | - | - | - | - | ✓ | - | Title + description + next action. |
| ErrorState | - | - | - | - | - | - | ✓ | `onRetry` seam; button hidden without it. |
| Tabs | ✓ | ✓ | ✓ | ✓ | - | - | - | WAI-ARIA tabs, roving tabindex, Arrow/Home/End. |
| Stepper | ✓ | - | - | - | - | - | ✓ | `<ol>` with `aria-current="step"`; status in hidden text and icons. |

## Progress and gamification
| Component | D | H | F | X | L | E | R | Notes |
|---|---|---|---|---|---|---|---|---|
| ProgressBar | ✓ | - | - | - | ✓ | ✓ | - | `role="progressbar"`, value + `aria-valuetext`, printed value. |
| ProgressRing | ✓ | - | - | - | ✓ | ✓ | - | Same ARIA; colour by `level` or `tone`; centre content is visual only. |
| XPBar | ✓ | - | - | - | ✓ | ✓ | - | "760 XP to Guardian" / "Top level reached". Thresholds are props. |
| LevelChip (+ LevelCrest) | ✓ | - | - | - | - | - | - | "L3 Practitioner" + pips (+ star for Defender). `compact` keeps name for SR. |
| LevelLadder | ✓ | - | - | - | - | - | - | Reached / Current / Locked in text; `aria-current` on the current tier. |
| AchievementBadge | ✓ | ✓ | ✓ | ✓ | ✓ | - | - | Not earned = dashed, lock, "Not earned yet". Unlock animation once, static under reduced motion. |
| BadgeGrid | ✓ | - | ✓ | - | ✓ | ✓ | ✓ | Single Tab stop, arrow-key roving focus. |
| StatTile | ✓ | ✓ | ✓ | - | ✓ | ✓ | ✓ | Delta has arrow + words; sentiment drives tone, never direction alone. |
| RiskChip | ✓ | - | - | - | ✓ | ✓ | - | Icon shape + "High risk"; governance state (Red) in text or SR text. `null` = "Not assessed". |
| RiskBreakdown | ✓ | - | - | - | ✓ | ✓ | ✓ | Four bars labelled with fixed weights; composite printed; never computed here. |

## Learning and quiz
| Component | D | H | F | X | L | E | R | Notes |
|---|---|---|---|---|---|---|---|---|
| ModuleCard | ✓ | ✓ | ✓ | ✓ | ✓ | - | ✓ | Locked: focusable `aria-disabled`, dashed, lock icon, unlock rule linked via `aria-describedby`. |
| ModuleList | ✓ | ✓ | ✓ | ✓ | ✓ | - | - | Sidebar `<nav>`; current `aria-current="page"`; locked items explain the rule. |
| VideoPlayerFrame | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Native video, 44px controls, captions track, transcript toggle, Space/K, arrows, M, C. No autoplay. |
| TranscriptPanel | ✓ | - | ✓ | - | ✓ | ✓ | - | Focusable scroll region; "Jump to m:ss" buttons via `onSeek`. |
| InteractiveExercise | ✓ | ✓ | ✓ | ✓ | - | - | - | Immediate feedback; choices lock after answering; Next is soft-disabled until answered. |
| FeedbackPanel | ✓ | - | ✓ | - | - | - | - | "Correct"/"Incorrect" + icon + explanation; focus moves to its heading. |
| QuizOption | ✓ | ✓ | ✓ | ✓ | - | - | - | Native radio styled as a card; selected = 2px border + filled letter; review tags "Your answer"/"Correct answer". |
| QuizQuestion | ✓ | - | ✓ | - | ✓ | - | ✓ | Heading "Question n of N"; stem is the `legend`. |
| QuestionNavigator | ✓ | ✓ | ✓ | - | - | - | - | 44px grid; names like "Question 4, answered, flagged for review". |
| ScoreSummary | ✓ | - | ✓ | - | ✓ | - | - | Pass/fail + pass mark from props; focus lands on the result heading. |
| LockdownBanner | ✓ | - | ✓ | - | ✓ | - | ✓ | Persistent, non-dismissible; "Exit quiz" always keyboard-reachable. |
| AttemptsIndicator | ✓ | - | - | - | - | - | ✓ | "2 of 3 attempts remaining"; last = caution, none = critical; polite live region. |

## Admin and layout support
| Component | D | H | F | X | L | E | R | Notes |
|---|---|---|---|---|---|---|---|---|
| DataTable | ✓ | ✓ | ✓ | - | ✓ | ✓ | ✓ | `<caption>`, `th scope`, sortable header buttons with `aria-sort`, 48px rows. Sorting happens outside. |
| SearchField | ✓ | ✓ | ✓ | ✓ | - | ✓ | - | `role="search"`, clear button, result count in a live region. |
| FilterBar | ✓ | - | - | - | - | - | - | `role="group"`; "Clear filters (n)" only when active. |
| Pagination | ✓ | ✓ | ✓ | ✓ | - | - | - | `<nav>`, `aria-current="page"`, collapsed ranges. |
| BarChart | ✓ | ✓ | ✓ | - | ✓ | ✓ | ✓ | HTML bars with printed values; "View as table" toggle (`aria-pressed`). |
| Scoreboard | ✓ | ✓ | ✓ | - | ✓ | ✓ | ✓ | Ordered list; disclosure rows (`aria-expanded`) reveal RiskBreakdown. |
| EscalationList | ✓ | ✓ | ✓ | - | ✓ | ✓ | ✓ | Severity in text ("Critical:") + icon + left bar. |
| Avatar | ✓ | - | - | - | - | ✓ | - | Initials fallback; decorative by default. |
| BrandLogo | ✓ | - | - | - | - | ✓ | ✓ | Theme-specific asset; falls back to default, then app name as text. |

## Layouts
- `AppShell`: skip link, sidebar `nav` (current page bar + tint + weight), page `h1`, `main`.
- `GateShell`: chrome-free full-screen frame for gate, login and onboarding.
- `LockdownShell`: banner + exit confirmation; only renders quiz content when lockdown is `active`.
