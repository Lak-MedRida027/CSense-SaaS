import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { RiskBreakdown } from './RiskBreakdown';

const scores = { knowledge: 35, behavioural: 60, simulation: 85, engagement: 40 };

describe('RiskBreakdown', () => {
  it('labels each dimension with its fixed weight and value', () => {
    render(<RiskBreakdown scores={scores} composite={72} level="High" />);
    expect(screen.getByRole('progressbar', { name: 'Knowledge (weight 30%)' })).toBeDefined();
    expect(screen.getByRole('progressbar', { name: 'Behavioural (weight 25%)' })).toBeDefined();
    expect(screen.getByRole('progressbar', { name: 'Simulation (weight 30%)' })).toBeDefined();
    expect(screen.getByRole('progressbar', { name: 'Engagement (weight 15%)' })).toBeDefined();
    expect(screen.getByText('72')).toBeDefined();
  });

  it('has no axe violations', async () => {
    const { container } = render(<RiskBreakdown scores={scores} composite={72} level="High" />);
    await expectNoA11yViolations(container);
  });
});
