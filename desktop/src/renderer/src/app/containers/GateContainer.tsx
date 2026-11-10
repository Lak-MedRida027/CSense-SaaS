import { useCallback, useState } from 'react';
import type { GateView } from '../../../../shared/ipcChannels';
import {
  GateBootScreen,
  GateMisconfiguredScreen,
  GateOfflineScreen,
  SecurityGateScreen,
  type GateChallenge,
} from '../../screens/SecurityGate';
import { useAppState, useBridge } from '../AppProvider';
import { gateErrorMessage } from '../messages';

const EMPTY_CHALLENGE: GateChallenge = { id: '', prompt: '', options: [] };
/** Auto-continue delay after "Access granted" when an existing clearance applies. */
export const AUTO_CONTINUE_MS = 2000;

const CONTACT_TEXT = import.meta.env.RENDERER_VITE_SECURITY_CONTACT_TEXT;

/** Renders the gate for every phase main reports while the workstation is locked. */
export function GateContainer({ view }: { view: GateView }) {
  const bridge = useBridge();
  const { appVersion } = useAppState();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [retrying, setRetrying] = useState(false);

  const signOut = useCallback(() => {
    void bridge.session.logout();
  }, [bridge]);

  const onContinue = useCallback(() => {
    void bridge.gate.continue();
  }, [bridge]);

  const onSubmit = useCallback(
    async (optionId: string) => {
      const challenge = view.challenge;
      if (!challenge) return;
      setSubmitting(true);
      setError(undefined);
      try {
        const res = await bridge.gate.submitAnswer({
          challengeId: challenge.challengeId,
          optionIndex: Number(optionId),
        });
        if (!res.ok) setError(gateErrorMessage(res.error));
      } catch {
        setError(gateErrorMessage({ code: 'NETWORK_UNAVAILABLE', message: '' }));
      } finally {
        setSubmitting(false);
      }
    },
    [bridge, view.challenge],
  );

  switch (view.phase) {
    case 'misconfigured':
      return <GateMisconfiguredScreen appVersion={appVersion} />;
    case 'offline':
      return (
        <GateOfflineScreen
          appVersion={appVersion}
          retrying={retrying}
          canContinueOffline={view.offline?.canContinueOffline ?? false}
          onRetry={() => {
            setRetrying(true);
            void bridge.gate.requestChallenge().finally(() => {
              setRetrying(false);
            });
          }}
          onContinueOffline={() => {
            void bridge.gate.continueOffline();
          }}
          onSignOut={signOut}
        />
      );
    case 'challenge':
    case 'granted':
    case 'restricted': {
      const challenge: GateChallenge = view.challenge
        ? {
            id: view.challenge.challengeId,
            prompt: view.challenge.prompt,
            options: view.challenge.options.map((text, i) => ({ id: String(i), text })),
          }
        : EMPTY_CHALLENGE;
      return (
        <SecurityGateScreen
          state={view.phase}
          challenge={challenge}
          attemptsRemaining={view.attemptsRemaining}
          maxAttempts={view.maxAttempts}
          feedback={view.feedback ?? undefined}
          errorMessage={error}
          submitting={submitting}
          onSubmitGateAnswer={(id) => {
            void onSubmit(id);
          }}
          onContinue={onContinue}
          autoContinueMs={
            view.phase === 'granted' && view.autoContinue ? AUTO_CONTINUE_MS : undefined
          }
          restricted={
            view.restricted?.referenceId
              ? {
                  referenceId: view.restricted.referenceId,
                  contactText: CONTACT_TEXT || undefined,
                }
              : undefined
          }
          onSignOut={view.admin ? undefined : signOut}
          appVersion={appVersion}
        />
      );
    }
    default:
      return <GateBootScreen appVersion={appVersion} />;
  }
}
