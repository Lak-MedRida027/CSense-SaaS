import type { LoginScreenProps } from './Login.types';

const placeholder = (): void => undefined;

export const loginIdleFixture: LoginScreenProps = {
  onSubmitCredentials: placeholder,
  status: 'idle',
  appVersion: '0.1.0',
};

export const loginErrorFixture: LoginScreenProps = {
  ...loginIdleFixture,
  initialEmail: 'amina.benali@example.com',
  errorMessage: 'Email or password is incorrect.',
};

export const loginSubmittingFixture: LoginScreenProps = {
  ...loginIdleFixture,
  initialEmail: 'amina.benali@example.com',
  status: 'submitting',
};
