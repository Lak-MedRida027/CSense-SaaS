import type { GateOfflineScreenProps } from './GateStates';

const placeholder = (): void => undefined;

export const gateOfflineFixture: GateOfflineScreenProps = {
  onRetry: placeholder,
  canContinueOffline: false,
  onContinueOffline: placeholder,
  onSignOut: placeholder,
  appVersion: '0.1.0',
};

export const gateOfflineGraceElapsedFixture: GateOfflineScreenProps = {
  ...gateOfflineFixture,
  canContinueOffline: true,
};
