import { useRef } from 'react';
import { type DisplayPreferences } from '../../design/theme/ThemeContext';
import { useTheme } from '../../design/theme/useTheme';
import { Button } from '../Button';
import { Dialog } from '../Dialog';
import { RadioGroup } from '../RadioGroup';
import { Switch } from '../Switch';
import styles from './DisplaySettingsDialog.module.css';

export interface DisplaySettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Theme, reduce motion and text size: the same controls as the last onboarding step. Changes apply
 * (and persist through the ThemeProvider callback) immediately, so there is nothing to save.
 */
export function DisplaySettingsDialog({ open, onClose }: DisplaySettingsDialogProps) {
  const { preferences, setPreferences } = useTheme();
  const doneRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      title="Display settings"
      description="Changes apply straight away and are remembered on this computer."
      onClose={onClose}
      initialFocusRef={doneRef}
      footer={
        <Button ref={doneRef} onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className={styles.body}>
        <RadioGroup
          legend="Theme"
          orientation="horizontal"
          value={preferences.theme}
          onChange={(v) => {
            setPreferences({ theme: v as DisplayPreferences['theme'] });
          }}
          options={[
            { value: 'dark', label: 'Dark (default)' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'Match my computer' },
          ]}
        />
        <Switch
          label="Reduce motion"
          description="Turns off animations such as badge celebrations."
          checked={preferences.motion === 'reduced'}
          onChange={(on) => {
            setPreferences({ motion: on ? 'reduced' : 'system' });
          }}
        />
        <RadioGroup
          legend="Text size"
          orientation="horizontal"
          value={preferences.textSize}
          onChange={(v) => {
            setPreferences({ textSize: v as DisplayPreferences['textSize'] });
          }}
          options={[
            { value: 'default', label: 'Default' },
            { value: 'large', label: 'Large' },
            { value: 'larger', label: 'Larger' },
          ]}
        />
      </div>
    </Dialog>
  );
}
