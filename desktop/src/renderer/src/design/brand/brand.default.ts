import markDarkUrl from '../../assets/brand/csense-mark.svg';
import markLightUrl from '../../assets/brand/csense-mark-light.svg';
import wordmarkDarkUrl from '../../assets/brand/csense-wordmark-dark.svg';
import wordmarkLightUrl from '../../assets/brand/csense-wordmark-light.svg';
import type { BrandConfig } from './brand.types';

/**
 * Neutral CSense brand, used until the client confirms a logo or primary colour (D11, D12).
 * Assets are monochrome; each `dark` variant is the one shown on dark surfaces.
 */
export const defaultBrand: BrandConfig = {
  appName: 'CSense',
  orgName: undefined,
  logoMark: { dark: markDarkUrl, light: markLightUrl },
  logoWordmark: { dark: wordmarkDarkUrl, light: wordmarkLightUrl },
  colors: undefined,
};
