import { RISK_LEVEL_TO_STATE, type GovernanceState, type RiskLevel } from '@csense/shared';
import type { StatusTone } from './semantic';

export type RiskIconName = 'shield-check' | 'triangle-alert' | 'octagon-alert';

export interface RiskToken {
  /** Risk bands alias the status set; they never own colours. */
  tone: StatusTone;
  /** Distinct icon shape per band so risk is never colour-only. */
  icon: RiskIconName;
  label: string;
  governance: GovernanceState;
}

/** Low = Green = success, Medium = Amber = caution, High = Red = critical (locked). */
export const riskTokens: Record<RiskLevel, RiskToken> = {
  Low: {
    tone: 'success',
    icon: 'shield-check',
    label: 'Low risk',
    governance: RISK_LEVEL_TO_STATE.Low,
  },
  Medium: {
    tone: 'caution',
    icon: 'triangle-alert',
    label: 'Medium risk',
    governance: RISK_LEVEL_TO_STATE.Medium,
  },
  High: {
    tone: 'critical',
    icon: 'octagon-alert',
    label: 'High risk',
    governance: RISK_LEVEL_TO_STATE.High,
  },
};
