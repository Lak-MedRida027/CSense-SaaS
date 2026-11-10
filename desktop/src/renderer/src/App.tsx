import { EXPECTED_MODULE_COUNT } from '@csense/shared';
import { AppProvider } from './app/AppProvider';
import { AppRouter } from './app/AppRouter';
import { getBridge } from './app/bridge';
import { useTheme } from './design/theme/useTheme';
import styles from './App.module.css';

/**
 * Root of the desktop UI. Inside the Electron shell it routes on main's gate state; without the
 * preload bridge (a plain browser, or a mismatched bridge version) it shows a static notice, so
 * nothing can pretend to grant access.
 */
export function App() {
  const bridge = getBridge();
  const { brand } = useTheme();
  if (bridge) {
    return (
      <AppProvider bridge={bridge}>
        <AppRouter />
      </AppProvider>
    );
  }
  return (
    <main className={styles.shell}>
      <div className={styles.center}>
        <h1 className={styles.title}>{brand.appName}</h1>
        <p className={styles.subtitle}>
          Security awareness training · {EXPECTED_MODULE_COUNT} modules
        </p>
        <p className={styles.subtitle}>Open CSense from the desktop app to sign in.</p>
      </div>
    </main>
  );
}
