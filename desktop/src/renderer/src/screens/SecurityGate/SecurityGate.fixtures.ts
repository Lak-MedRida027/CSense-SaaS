import type { SecurityGateScreenProps } from './SecurityGate.types';

/** Placeholder seam: logs nothing, does nothing. Engineers replace with real handlers. */
const placeholder = (): void => undefined;

const challenge: SecurityGateScreenProps['challenge'] = {
  id: 'gate-q-1',
  prompt:
    'You receive an urgent email from "IT Support" asking you to confirm your password. What should you do?',
  options: [
    { id: 'a', text: 'Reply with your password so IT can fix the issue' },
    { id: 'b', text: 'Report it with the Report Phishing button and delete it' },
    { id: 'c', text: 'Forward it to a colleague to check if it is real' },
  ],
};

export const securityGateChallengeFixture: SecurityGateScreenProps = {
  state: 'challenge',
  challenge,
  attemptsRemaining: 3,
  maxAttempts: 3,
  onSubmitGateAnswer: placeholder,
  onContinue: placeholder,
  appVersion: '0.1.0',
};

export const securityGateRetryFixture: SecurityGateScreenProps = {
  ...securityGateChallengeFixture,
  attemptsRemaining: 1,
  feedback: {
    correct: false,
    explanation:
      'IT will never ask for your password by email. Report suspicious messages instead of replying.',
  },
};

export const securityGateGrantedFixture: SecurityGateScreenProps = {
  ...securityGateChallengeFixture,
  state: 'granted',
  feedback: { correct: true, explanation: 'Reporting phishing protects everyone. Well done.' },
};

export const securityGateRestrictedFixture: SecurityGateScreenProps = {
  ...securityGateChallengeFixture,
  state: 'restricted',
  attemptsRemaining: 0,
  restricted: {
    referenceId: 'GATE-2026-10-24-0042',
    contactText: 'Security team: ext. 4400 or security@example.com',
    onContactSecurityTeam: placeholder,
  },
};
