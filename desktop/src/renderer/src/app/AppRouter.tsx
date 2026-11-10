import { GateBootScreen } from '../screens/SecurityGate';
import { useAppState } from './AppProvider';
import { GateContainer } from './containers/GateContainer';
import { LoginContainer } from './containers/LoginContainer';
import { Workspace } from './Workspace';

/**
 * Small state router driven by main's gate state (plan 9): Boot -> Login -> SecurityGate ->
 * TrainingHome -> Quiz. The renderer never decides access: it renders what main reports.
 */
export function AppRouter() {
  const { ready, gate, appVersion } = useAppState();
  if (!ready || !gate) return <GateBootScreen label="Starting CSense…" appVersion={appVersion} />;
  switch (gate.phase) {
    case 'signed_out':
      return <LoginContainer />;
    case 'released':
      return <Workspace />;
    default:
      return <GateContainer view={gate} />;
  }
}
