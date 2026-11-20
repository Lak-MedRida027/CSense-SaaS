import './design/tokens/tokens.generated.css';
import './styles/global.css';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { browserStorage, loadPreferences, savePreferences } from './app/preferences';
import { ThemeProvider } from './design/theme/ThemeProvider';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

/**
 * Dev-only styleguide and screen previews (#/styleguide, #/preview/...). Statically false in
 * production builds, so the dev chunk is dropped; `--mode styleguide` builds include it for the
 * Playwright a11y spec.
 */
const DevRoutes =
  import.meta.env.DEV || import.meta.env.MODE === 'styleguide'
    ? lazy(() => import('./dev/devRoutes'))
    : null;

// Display preferences are the only renderer storage (plan 6): validated on read, written on change.
const storage = browserStorage();
const initialPreferences = loadPreferences(storage);

createRoot(container).render(
  <StrictMode>
    <ThemeProvider
      initialPreferences={initialPreferences}
      onPreferencesChange={(prefs) => {
        savePreferences(storage, prefs);
      }}
    >
      {DevRoutes ? (
        <Suspense fallback={null}>
          <DevRoutes fallback={<App />} />
        </Suspense>
      ) : (
        <App />
      )}
    </ThemeProvider>
  </StrictMode>,
);
