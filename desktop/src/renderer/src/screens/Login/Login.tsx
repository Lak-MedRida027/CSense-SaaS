import { useEffect, useId, useRef, useState } from 'react';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { PasswordField } from '../../components/PasswordField';
import { Stepper } from '../../components/Stepper';
import { TextField } from '../../components/TextField';
import { useTheme } from '../../design/theme/useTheme';
import { Mail } from '../../icons';
import { GateShell } from '../../layouts/GateShell';
import { gateSteps } from '../SecurityGate/SecurityGate.types';
import type { LoginScreenProps } from './Login.types';
import styles from './Login.module.css';

/**
 * Sign-in (gate step 1). There is deliberately no registration and no self-service reset:
 * accounts are created by administrators only.
 */
export function LoginScreen({
  onSubmitCredentials,
  status,
  errorMessage,
  orgName,
  initialEmail = '',
  appVersion,
}: LoginScreenProps) {
  const { brand } = useTheme();
  const headingId = useId();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);
  const submitting = status === 'submitting';
  const org = orgName ?? brand.orgName;

  useEffect(() => {
    if (errorMessage) errorRef.current?.focus();
  }, [errorMessage]);

  return (
    <GateShell
      statusText="Workstation locked"
      footer={
        <>
          <span>
            Accounts are created by {org ? `${org}'s` : "your organisation's"} security team.
          </span>
          {appVersion && <span>v{appVersion}</span>}
        </>
      }
    >
      <div className={styles.column}>
        <Stepper label="Workstation access" steps={gateSteps('sign-in')} />
        <section className={styles.panel} aria-labelledby={headingId}>
          <h1 id={headingId} className={styles.heading}>
            Sign in
          </h1>
          <p className={styles.lead}>Sign in to continue to your workstation.</p>
          {errorMessage && (
            <div ref={errorRef} tabIndex={-1} className={styles.errorWrap}>
              <Alert tone="critical" title={errorMessage} />
            </div>
          )}
          <form
            className={styles.form}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!submitting) onSubmitCredentials({ email: email.trim(), password });
            }}
          >
            <TextField
              label="Work email"
              type="email"
              autoComplete="username"
              leadingIcon={Mail}
              placeholder="name@company.com"
              value={email}
              required
              disabled={submitting}
              onChange={(e) => {
                setEmail(e.currentTarget.value);
              }}
            />
            <PasswordField
              label="Password"
              value={password}
              required
              disabled={submitting}
              onChange={(e) => {
                setPassword(e.currentTarget.value);
              }}
            />
            <Button type="submit" size="lg" fullWidth loading={submitting}>
              Sign in
            </Button>
          </form>
          <p className={styles.help}>Forgot your password? Contact your administrator.</p>
        </section>
      </div>
    </GateShell>
  );
}
