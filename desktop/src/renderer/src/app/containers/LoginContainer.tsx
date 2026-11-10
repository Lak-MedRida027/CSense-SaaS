import { useCallback, useState } from 'react';
import { LoginScreen } from '../../screens/Login';
import { useAppState, useBridge } from '../AppProvider';
import { SESSION_ENDED_MESSAGE, loginErrorMessage } from '../messages';

/** Wires the Login screen to `session.login`. The password never lives outside the form. */
export function LoginContainer() {
  const bridge = useBridge();
  const { session, appVersion } = useAppState();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // Remounting the form clears the password field after EVERY attempt, successful or not.
  const [formKey, setFormKey] = useState(0);
  const [email, setEmail] = useState('');

  const onSubmit = useCallback(
    async (credentials: { email: string; password: string }) => {
      setSubmitting(true);
      setError(undefined);
      setEmail(credentials.email);
      try {
        const res = await bridge.session.login(credentials);
        if (!res.ok) setError(loginErrorMessage(res.error));
      } catch {
        setError("Can't reach CSense.");
      } finally {
        setSubmitting(false);
        setFormKey((k) => k + 1);
      }
    },
    [bridge],
  );

  return (
    <LoginScreen
      key={formKey}
      status={submitting ? 'submitting' : 'idle'}
      errorMessage={error ?? (session.endedNotice ? SESSION_ENDED_MESSAGE : undefined)}
      initialEmail={email}
      appVersion={appVersion}
      onSubmitCredentials={(c) => {
        void onSubmit(c);
      }}
    />
  );
}
