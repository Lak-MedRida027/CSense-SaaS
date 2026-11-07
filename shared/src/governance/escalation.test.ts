import { describe, expect, it } from 'vitest';
import {
  ESCALATION_ACTIONS,
  ESCALATION_REASONS,
  ESCALATION_RESOLUTIONS,
  ESCALATION_STATUSES,
  type EscalationAction,
  type EscalationStatus,
} from '../constants/governance.js';
import { applyEscalationAction } from './escalation.js';

describe('escalation state machine', () => {
  it('ES1: the full status x action table', () => {
    const table: Record<EscalationStatus, Record<EscalationAction, EscalationStatus | null>> = {
      open: { acknowledge: 'acknowledged', note: 'open', resolve: null },
      acknowledged: { acknowledge: null, note: 'acknowledged', resolve: 'resolved' },
      resolved: { acknowledge: null, note: 'resolved', resolve: null },
    };
    for (const status of ESCALATION_STATUSES) {
      for (const action of ESCALATION_ACTIONS) {
        const expected = table[status][action];
        const result = applyEscalationAction(status, action);
        expect(result, `${status} + ${action}`).toStrictEqual(
          expected === null
            ? { ok: false, reason: 'invalid_transition' }
            : { ok: true, next: expected },
        );
      }
    }
  });

  it('ES2: the action, status, reason and resolution lists are exact', () => {
    expect(ESCALATION_ACTIONS).toStrictEqual(['acknowledge', 'note', 'resolve']);
    expect(ESCALATION_STATUSES).toStrictEqual(['open', 'acknowledged', 'resolved']);
    expect(ESCALATION_RESOLUTIONS).toStrictEqual([
      'remediated',
      'risk_accepted',
      'false_positive',
      'no_action_required',
    ]);
    expect(ESCALATION_REASONS).toStrictEqual([
      'risk_level_high',
      'simulation_credentials_submitted',
      'gate_access_restricted',
      'repeated_assessment_cooldowns',
    ]);
  });
});
