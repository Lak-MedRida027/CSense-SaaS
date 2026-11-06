import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { Scoreboard } from './Scoreboard';

const entries = [
  {
    id: 'e1',
    rank: 1,
    name: 'Karim Diaz',
    department: 'Finance',
    compositeScore: 72,
    riskLevel: 'High' as const,
    scores: { knowledge: 35, behavioural: 60, simulation: 85, engagement: 40 },
  },
];

describe('Scoreboard', () => {
  it('expands a row into the risk breakdown (disclosure pattern)', () => {
    render(<Scoreboard title="Risk scoreboard" entries={entries} />);
    const toggle = screen.getByRole('button', { name: 'Risk breakdown for Karim Diaz' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('progressbar', { name: 'Knowledge (weight 30%)' })).toBeDefined();
  });

  it('opens the employee via the seam', () => {
    const onOpenEntry = vi.fn();
    render(<Scoreboard title="Risk" entries={entries} onOpenEntry={onOpenEntry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Karim Diaz' }));
    expect(onOpenEntry).toHaveBeenCalledWith('e1');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <Scoreboard title="Risk" entries={entries} onOpenEntry={() => undefined} />,
    );
    await expectNoA11yViolations(container);
  });
});
