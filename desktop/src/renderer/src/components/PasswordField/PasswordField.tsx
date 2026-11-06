import { useState, type KeyboardEvent } from 'react';
import { Eye, EyeOff, TriangleAlert } from '../../icons';
import { IconButton } from '../IconButton';
import { TextField, type TextFieldProps } from '../TextField';
import styles from './PasswordField.module.css';

export type PasswordFieldProps = Omit<TextFieldProps, 'type' | 'endAdornment' | 'status'>;

/**
 * Password input with a show/hide toggle (aria-pressed) and a Caps Lock warning announced
 * politely. Defaults to `autoComplete="current-password"`.
 */
export function PasswordField({
  autoComplete = 'current-password',
  onKeyDown,
  onKeyUp,
  disabled,
  ...rest
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const trackCaps = (e: KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(e.getModifierState('CapsLock'));
  };

  return (
    <TextField
      {...rest}
      disabled={disabled}
      type={visible ? 'text' : 'password'}
      autoComplete={autoComplete}
      spellCheck={false}
      onKeyDown={(e) => {
        trackCaps(e);
        onKeyDown?.(e);
      }}
      onKeyUp={(e) => {
        trackCaps(e);
        onKeyUp?.(e);
      }}
      status={
        capsLock ? (
          <span className={styles.caps}>
            <TriangleAlert aria-hidden="true" size={16} />
            Caps Lock is on
          </span>
        ) : undefined
      }
      endAdornment={
        <IconButton
          icon={visible ? EyeOff : Eye}
          label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          disabled={disabled}
          size="sm"
          tooltipPlacement="top"
          onClick={() => {
            setVisible((v) => !v);
          }}
        />
      }
    />
  );
}
