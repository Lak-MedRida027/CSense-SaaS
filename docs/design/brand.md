# Brand plug-in points

Until the deploying organisation confirms its identity (D12), CSense ships a **neutral, monochrome**
brand. A client brand is a `BrandConfig` (`design/brand/brand.types.ts`) passed to `ThemeProvider`.
It is always run through `validateBrand()` first.

## What a brand may override

| Slot | Used for | Neutral default |
|---|---|---|
| `appName` | Window/document title, wordmark alt text, gate heading | "CSense" |
| `orgName` | "Accounts are created by {orgName}'s security team" | none -> "your organisation's" |
| `logoMark` `{dark, light}` | Sidebar, gate header (square, 32-128px) | Monochrome shield mark (`assets/brand/csense-mark*.svg`) |
| `logoWordmark` `{dark, light}` | Login, gate, onboarding, sidebar | Shield + "CSense" (`assets/brand/csense-wordmark-*.svg`) |
| `colors.primary` | Primary buttons, selected nav bar and tint, selected options, current step | Monochrome: `#E6EDF3` on dark, `#0F172A` on light |
| `colors.accent` | Decorative only (illustrations, splash) | none (`--cs-color-brand-accent` falls back to text-secondary) |
| App/installer icon | electron-builder (devops, Phase 10) | CSense icon |

**Never overridable:** surfaces, text, borders, focus ring, status colours, risk bands, level
colours, type, spacing, motion.

## Guardrails (`validateBrand`, unit-tested)
1. **Contrast.** The primary must reach 3:1 against canvas and surface-1 in each theme. If it does
   not, its OKLCH lightness is shifted (lighter for dark, darker for light) until it does; a warning
   records the adjusted value. The on-primary colour is whichever of near-black or white reaches
   4.5:1; if neither can, the neutral primary is used.
2. **Semantic collision.** A chromatic primary (OKLCH chroma at least 0.05) within 30 degrees of any
   status hue (info 252, success 155, caution 81, critical 23) is **demoted to decorative mode**: it
   becomes the accent for logo/splash use and buttons stay monochrome. Blue brands will usually land
   here, because blue means "info".
3. **Level proximity.** Within 20 degrees of a level hue only warns (levels always show numerals and
   pips).
4. **Focus ring** is fixed and never brand-derived.
5. **Fail safe.** Invalid hex values, empty names and unsafe assets fall back to the neutral default
   with a developer warning (logged in dev builds). Branding never throws.
6. **Assets** must be bundled paths or `data:image/...` URIs. Remote and protocol URLs are rejected
   (CSP `img-src 'self' data:`). Logos render through `<img>`, never as inline markup.

## Applying a brand
```tsx
import { ThemeProvider } from './design';
import acmeMarkDark from './assets/brand/acme-mark-dark.svg';
import acmeMarkLight from './assets/brand/acme-mark-light.svg';

<ThemeProvider
  brand={{
    appName: 'Acme Aware',
    orgName: 'Acme',
    logoMark: { dark: acmeMarkDark, light: acmeMarkLight },
    colors: { primary: '#7B3FA0' },
  }}
>
  <App />
</ThemeProvider>
```
`useTheme().brand.colorMode` reports `neutral`, `interactive` or `decorative`, and
`brand.warnings` explains any adjustment. Where the brand config comes from (bundled file vs
server) is an engineering decision; the default is a bundled file until the client is confirmed.
