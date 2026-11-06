import type { ReactNode } from 'react';
import type { StepItem } from '../../components/Stepper';

/** Gate stages after sign-in. Sign-in itself is the Login screen (gate step 1). */
export type GateState = 'challenge' | 'granted' | 'restricted';

export interface GateChallenge {
  id: string;
  /** e.g. "You receive an urgent email from IT asking for your password. What should you do?" */
  prompt: ReactNode;
  options: readonly { id: string; text: ReactNode }[];
}

export interface GateFeedback {
  correct: boolean;
  explanation: ReactNode;
}

export interface SecurityGateScreenProps {
  state: GateState;
  challenge: GateChallenge;
  /** Remaining attempts before the restricted state (limit configured server-side, D4 default 3). */
  attemptsRemaining: number;
  maxAttempts: number;
  /** Feedback for the last submitted answer (shown immediately, with the explanation). */
  feedback?: GateFeedback | undefined;
  /** True while the answer is being checked. */
  submitting?: boolean | undefined;
  /** Seam: submit the selected option. Correctness is decided outside the UI. */
  onSubmitGateAnswer: (optionId: string) => void;
  /** Seam: proceed once access is granted. */
  onContinue: () => void;
  /**
   * Auto-continue delay after "Access granted" (ms). Never required: a "Continue now" button is
   * always shown. Omit to disable auto-continue.
   */
  autoContinueMs?: number | undefined;
  /** Restricted state details. */
  restricted?:
    | {
        referenceId: string;
        /** Seam: open the contact route (e.g. show phone/email). */
        onContactSecurityTeam?: (() => void) | undefined;
        contactText?: string | undefined;
      }
    | undefined;
  appVersion?: string | undefined;
  helpText?: string | undefined;
}

/** The three-step gate stepper, shared by the Login and SecurityGate screens. */
export function gateSteps(current: 'sign-in' | GateState): StepItem[] {
  const order = ['sign-in', 'challenge', 'granted'] as const;
  const idx = current === 'restricted' ? 1 : order.indexOf(current);
  const labels = { 'sign-in': 'Sign in', challenge: 'Security check', granted: 'Access granted' };
  return order.map((id, i) => ({
    id,
    label: labels[id],
    status:
      current === 'restricted' && i === 1
        ? 'error'
        : i < idx
          ? 'complete'
          : i === idx
            ? current === 'granted'
              ? 'complete'
              : 'current'
            : 'upcoming',
  }));
}
