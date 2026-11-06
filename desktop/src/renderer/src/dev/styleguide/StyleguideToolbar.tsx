import type { ReactNode } from 'react';
import { Switch } from '../../components/Switch';
import { useTheme } from '../../design/theme/useTheme';
import styles from './Styleguide.module.css';

/** Dev toolbar: theme and reduced-motion toggles plus page-specific controls. */
export function StyleguideToolbar({ children }: { children?: ReactNode }) {
  const { resolvedTheme, preferences, setPreferences } = useTheme();
  return (
    <div className={styles.toolbar} role="region" aria-label="Styleguide controls">
      <div className={styles.toolbarLeft}>{children}</div>
      <div className={styles.toolbarRight}>
        <Switch
          label="Light theme"
          checked={resolvedTheme === 'light'}
          onChange={(on) => {
            setPreferences({ theme: on ? 'light' : 'dark' });
          }}
        />
        <Switch
          label="Reduce motion"
          checked={preferences.motion === 'reduced'}
          onChange={(on) => {
            setPreferences({ motion: on ? 'reduced' : 'system' });
          }}
        />
      </div>
    </div>
  );
}
