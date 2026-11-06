export interface LoginCredentials {
  email: string;
  password: string;
}

export interface LoginScreenProps {
  /** Seam: submit credentials. Auth, rate limiting and lockout live outside the UI. */
  onSubmitCredentials: (credentials: LoginCredentials) => void;
  status: 'idle' | 'submitting';
  /**
   * Generic error to show (never reveal whether the account exists), e.g.
   * "Email or password is incorrect."
   */
  errorMessage?: string | undefined;
  /** Deploying organisation's name for the "accounts are created by" copy. */
  orgName?: string | undefined;
  initialEmail?: string | undefined;
  appVersion?: string | undefined;
}
