import { useEffect, useId, useRef } from 'react';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Spinner } from '../../components/Spinner';
import { Stepper } from '../../components/Stepper';
import { OctagonAlert, RotateCcw, WifiOff } from '../../icons';
import { GateShell } from '../../layouts/GateShell';
import { gateSteps } from './SecurityGate.types';
import styles from './SecurityGate.module.css';

/** Start-up / checking spinner on the locked gate frame. */
export function GateBootScreen({
  label = 'Checking your access…',
  appVersion,
}: {
  label?: string | undefined;
  appVersion?: string | undefined;
}) {
  return (
    <GateShell
      statusText="Workstation locked"
      footer={appVersion ? <span>v{appVersion}</span> : null}
    >
      <div className={styles.column}>
        <section className={styles.panel} data-tone="neutral" aria-busy="true">
          <Spinner size="lg" decorative />
          <h1 className={styles.heading} aria-live="polite">
            {label}
          </h1>
        </section>
      </div>
    </GateShell>
  );
}

export interface GateOfflineScreenProps {
  /** Seam: check the connection again now. */
  onRetry: () => void;
  retrying?: boolean | undefined;
  /** True once the grace period has elapsed and policy allows it (D5-12). */
  canContinueOffline: boolean;
  /** Seam: explicit "Continue offline". */
  onContinueOffline: () => void;
  onSignOut?: (() => void) | undefined;
  appVersion?: string | undefined;
}

/** The API cannot be reached. The workstation stays locked until the grace period allows an explicit choice. */
export function GateOfflineScreen({
  onRetry,
  retrying = false,
  canContinueOffline,
  onContinueOffline,
  onSignOut,
  appVersion,
}: GateOfflineScreenProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <GateShell
      statusText="Workstation locked"
      statusIcon={WifiOff}
      footer={
        <>
          <span>Need help? Contact your security team.</span>
          {appVersion && <span>v{appVersion}</span>}
        </>
      }
    >
      <div className={styles.column}>
        <Stepper label="Workstation access" steps={gateSteps('challenge')} />
        <section className={styles.panel} data-tone="caution" aria-labelledby={headingId}>
          <WifiOff aria-hidden="true" size={48} className={styles.bigIcon} />
          <h1 id={headingId} ref={headingRef} tabIndex={-1} className={styles.heading}>
            Can&apos;t reach CSense
          </h1>
          <p className={styles.lead} role="status">
            Retrying automatically. Your security check will start as soon as the connection is
            back.
          </p>
          {canContinueOffline && (
            <Alert tone="caution" title="Still offline" announce>
              You can continue without the security check. This is recorded on this computer, and
              CSense locks again as soon as it can reach the server.
            </Alert>
          )}
          <div className={styles.actions}>
            <Button variant="secondary" iconStart={RotateCcw} loading={retrying} onClick={onRetry}>
              Retry now
            </Button>
            {canContinueOffline && <Button onClick={onContinueOffline}>Continue offline</Button>}
          </div>
          {onSignOut && (
            <Button variant="ghost" size="sm" onClick={onSignOut}>
              Sign out
            </Button>
          )}
        </section>
      </div>
    </GateShell>
  );
}

/** The build has no valid API address. Nothing is sent anywhere; the workstation stays covered. */
export function GateMisconfiguredScreen({ appVersion }: { appVersion?: string | undefined }) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <GateShell
      statusText="Workstation locked"
      footer={appVersion ? <span>v{appVersion}</span> : null}
    >
      <div className={styles.column}>
        <section className={styles.panel} data-tone="critical" aria-labelledby={headingId}>
          <OctagonAlert aria-hidden="true" size={48} className={styles.bigIcon} />
          <h1 id={headingId} ref={headingRef} tabIndex={-1} className={styles.heading}>
            CSense is misconfigured
          </h1>
          <p className={styles.lead}>
            This installation cannot connect to the training service. Contact IT.
          </p>
        </section>
      </div>
    </GateShell>
  );
}
