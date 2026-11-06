import type { BrandColors, ThemeName } from '../tokens';

/**
 * A logo asset with a variant per theme. Values must be bundled module URLs or `data:` URIs
 * (CSP `img-src 'self' data:`); remote URLs are rejected by `validateBrand`.
 */
export interface BrandAsset {
  dark: string;
  light: string;
}

/**
 * Everything a deploying organisation may override. Anything not listed here (surfaces, text,
 * status, risk, level colours, focus ring, type, spacing, motion) is locked.
 */
export interface BrandConfig {
  /** Window title, wordmark alt text, gate heading. */
  appName: string;
  /** Used in copy such as "Accounts are created by {orgName}'s security team". */
  orgName?: string | undefined;
  /** Square mark, 32-128px. Sidebar, gate header. */
  logoMark?: BrandAsset | undefined;
  /** Horizontal wordmark. Login, gate, splash. */
  logoWordmark?: BrandAsset | undefined;
  colors?:
    | {
        /** Hex. Drives primary buttons and the active nav indicator if it passes the guardrails. */
        primary?: string | undefined;
        /** Hex. Decorative only (illustrations, splash). Never used for text or status. */
        accent?: string | undefined;
      }
    | undefined;
}

/**
 * How the brand colour is applied after validation:
 * - `neutral`: no client colour; monochrome CSense primary.
 * - `interactive`: client primary drives buttons and selection indicators.
 * - `decorative`: client colour collides with a semantic hue, so it is limited to logo/splash areas.
 */
export type BrandColorMode = 'neutral' | 'interactive' | 'decorative';

export interface ResolvedBrand {
  appName: string;
  orgName: string | undefined;
  logoMark: BrandAsset | undefined;
  logoWordmark: BrandAsset | undefined;
  colorMode: BrandColorMode;
  /** Brand CSS values per theme; `undefined` means "use the token defaults". */
  primary: Record<ThemeName, BrandColors> | undefined;
  /** Decorative accent (also receives a colliding primary in `decorative` mode). */
  accent: string | undefined;
  /** Developer-facing explanations for anything that was rejected or adjusted. */
  warnings: string[];
}
