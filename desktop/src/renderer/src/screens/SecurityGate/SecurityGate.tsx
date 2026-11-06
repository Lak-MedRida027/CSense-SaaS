import { useEffect, useId, useRef, useState } from 'react';
import { AttemptsIndicator } from '../../components/AttemptsIndicator';
import { Button } from '../../components/Button';
import { FeedbackPanel } from '../../components/FeedbackPanel';
import { QuizOption } from '../../components/QuizOption';
import { Stepper } from '../../components/Stepper';
import { ArrowRight, Lock, LockOpen, OctagonAlert, ShieldCheck } from '../../icons';
import { GateShell } from '../../layouts/GateShell';
import { gateSteps, type SecurityGateScreenProps } from './SecurityGate.types';
import styles from './SecurityGate.module.css';

const LETTERS = 'ABCDEF';

/**
 * Pre-access security gate (after sign-in): one awareness check with limited attempts, then
 * "Access granted" or the restricted state. No business logic: correctness, attempt counting and
 * the security-team alert all happen outside the UI.
 */
export function SecurityGateScreen({
  state,
  challenge,
  attemptsRemaining,
  maxAttempts,
  feedback,
  submitting = false,
  onSubmitGateAnswer,
  onContinue,
  autoContinueMs,
  restricted,
  appVersion,
  helpText = 'Need help? Contact your security team.',
}: SecurityGateScreenProps) {
  const name = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the new state's heading so screen readers hear the outcome.
  useEffect(() => {
    headingRef.current?.focus();
  }, [state]);

  useEffect(() => {
    if (state !== 'granted' || autoContinueMs === undefined) return undefined;
    const t = window.setTimeout(onContinue, autoContinueMs);
    return () => {
      window.clearTimeout(t);
    };
  }, [state, autoContinueMs, onContinue]);

  const footer = (
    <>
      <span>{helpText}</span>
      {appVersion && <span>v{appVersion}</span>}
    </>
  );

  return (
    <GateShell
      statusText={state === 'granted' ? 'Access granted' : 'Workstation locked'}
      statusIcon={state === 'granted' ? LockOpen : Lock}
      footer={footer}
    >
      <div className={styles.column}>
        <Stepper label="Workstation access" steps={gateSteps(state)} />

        {state === 'challenge' && (
          <section className={styles.panel} aria-labelledby={`${name}-h`}>
            <h1 id={`${name}-h`} ref={headingRef} tabIndex={-1} className={styles.heading}>
              Security check
            </h1>
            <p className={styles.lead}>Before you continue, answer today&apos;s awareness check.</p>
            <form
              className={styles.form}
              onSubmit={(e) => {
                e.preventDefault();
                if (selected && !submitting) onSubmitGateAnswer(selected);
              }}
            >
              <fieldset className={styles.fieldset} disabled={submitting}>
                <legend className={styles.prompt}>{challenge.prompt}</legend>
                <div className={styles.options}>
                  {challenge.options.map((o, i) => (
                    <QuizOption
                      key={o.id}
                      name={name}
                      optionId={o.id}
                      letter={LETTERS[i] ?? String(i + 1)}
                      label={o.text}
                      checked={selected === o.id}
                      onSelect={setSelected}
                    />
                  ))}
                </div>
              </fieldset>
              {feedback && !feedback.correct && (
                <FeedbackPanel
                  correct={false}
                  explanation={feedback.explanation}
                  title="Not quite"
                />
              )}
              <div className={styles.actions}>
                <AttemptsIndicator remaining={attemptsRemaining} max={maxAttempts} />
                <Button type="submit" loading={submitting} softDisabled={!selected}>
                  Submit answer
                </Button>
              </div>
            </form>
          </section>
        )}

        {state === 'granted' && (
          <section className={styles.panel} data-tone="success" aria-labelledby={`${name}-g`}>
            <ShieldCheck aria-hidden="true" size={48} className={styles.bigIcon} />
            <h1 id={`${name}-g`} ref={headingRef} tabIndex={-1} className={styles.heading}>
              Access granted
            </h1>
            {feedback?.correct && <p className={styles.lead}>{feedback.explanation}</p>}
            <Button size="lg" iconEnd={ArrowRight} onClick={onContinue}>
              Continue now
            </Button>
            {autoContinueMs !== undefined && (
              <p className={styles.hint}>Continuing automatically in a moment.</p>
            )}
          </section>
        )}

        {state === 'restricted' && (
          <section className={styles.panel} data-tone="critical" aria-labelledby={`${name}-r`}>
            <OctagonAlert aria-hidden="true" size={48} className={styles.bigIcon} />
            <h1 id={`${name}-r`} ref={headingRef} tabIndex={-1} className={styles.heading}>
              Access restricted
            </h1>
            <p className={styles.lead}>
              You&apos;ve used all attempts. Your security team has been notified and will contact
              you.
            </p>
            {restricted && (
              <p className={styles.reference}>
                Reference: <code>{restricted.referenceId}</code>
              </p>
            )}
            {restricted?.contactText && <p className={styles.hint}>{restricted.contactText}</p>}
            {restricted?.onContactSecurityTeam && (
              <Button variant="secondary" onClick={restricted.onContactSecurityTeam}>
                Contact security team
              </Button>
            )}
          </section>
        )}
      </div>
    </GateShell>
  );
}
