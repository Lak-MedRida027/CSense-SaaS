import { RISK_LEVELS } from '@csense/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { RiskChip } from './RiskChip';

describe('RiskChip', () => {
  it.each([
    ['Low', 'Green', 'lucide-shield-check'],
    ['Medium', 'Amber', 'lucide-triangle-alert'],
    ['High', 'Red', 'lucide-octagon-alert'],
  ] as const)('%s risk is text + distinct icon + governance state', (level, state, iconClass) => {
    const { container } = render(<RiskChip level={level} />);
    expect(container.textContent).toContain(`${level} risk`);
    expect(container.textContent).toContain(state);
    expect(container.querySelector(`.${iconClass}`)).not.toBeNull();
    expect(container.firstElementChild?.getAttribute('data-risk')).toBe(level);
  });

  it('shows "Not assessed" for null', () => {
    render(<RiskChip level={null} />);
    expect(screen.getByText('Not assessed')).toBeDefined();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <div>
        {RISK_LEVELS.map((r) => (
          <RiskChip key={r} level={r} showGovernance />
        ))}
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
