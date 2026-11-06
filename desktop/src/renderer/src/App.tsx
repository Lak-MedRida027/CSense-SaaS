import { EXPECTED_MODULE_COUNT } from '@csense/shared';
import { useTheme } from './design/theme/useTheme';
import styles from './App.module.css';

/**
 * Phase 0/1 empty shell, now styled from design tokens. The security gate and real screens are
 * wired in Phases 5-7 (the presentational screens live in ./screens).
 */
export function App() {
  const { brand } = useTheme();
  return (
    <main className={styles.shell}>
      <div className={styles.center}>
        <h1 className={styles.title}>{brand.appName}</h1>
        <p className={styles.subtitle}>
          Security awareness training · {EXPECTED_MODULE_COUNT} modules
        </p>
      </div>
    </main>
  );
}
