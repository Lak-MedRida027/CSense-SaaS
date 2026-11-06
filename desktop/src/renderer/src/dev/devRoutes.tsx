import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { useTheme } from '../design/theme/useTheme';
import type { ThemeName } from '../design/tokens';
import { ScreenPreview } from './styleguide/ScreenPreview';
import { StyleguidePage } from './styleguide/StyleguidePage';

/**
 * Dev-only hash routes. Loaded lazily from main.tsx only when `import.meta.env.DEV` or the
 * `styleguide` build mode is set, so production bundles never include this code.
 *
 *   #/styleguide[/tokens|/components]         design tokens and the component gallery
 *   #/preview/<screen>/<variant>              a screen rendered with its fixture
 *   ...?theme=light&motion=reduced            optional display overrides (used by the a11y e2e)
 *
 * Hashes that do not start with "#/" (e.g. the "#main-content" skip link) are ignored.
 */
function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
  };
}

function useHash(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => '',
  );
}

export interface ParsedRoute {
  segments: string[];
  params: URLSearchParams;
}

export function parseHash(hash: string): ParsedRoute | null {
  if (!hash.startsWith('#/')) return null;
  const [path = '', query = ''] = hash.slice(2).split('?');
  return { segments: path.split('/').filter(Boolean), params: new URLSearchParams(query) };
}

export interface DevRoutesProps {
  /** Rendered when the hash is not a dev route (the real app). */
  fallback: ReactNode;
}

export default function DevRoutes({ fallback }: DevRoutesProps) {
  const route = parseHash(useHash());
  const { setPreferences } = useTheme();
  const themeParam = route?.params.get('theme');
  const motionParam = route?.params.get('motion');

  useEffect(() => {
    if (themeParam === 'dark' || themeParam === 'light') {
      setPreferences({ theme: themeParam satisfies ThemeName });
    }
    if (motionParam === 'reduced' || motionParam === 'full')
      setPreferences({ motion: motionParam });
  }, [themeParam, motionParam, setPreferences]);

  if (!route) return fallback;
  const [first, second, third] = route.segments;
  if (first === 'styleguide') return <StyleguidePage section={second ?? 'tokens'} />;
  if (first === 'preview' && second) return <ScreenPreview screenId={second} variantId={third} />;
  return fallback;
}
