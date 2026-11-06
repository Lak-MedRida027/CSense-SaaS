import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { StatTile } from './StatTile';

describe('StatTile', () => {
  it('shows value, unit and a worded delta', () => {
    render(
      <StatTile
        label="Completion"
        value={62}
        unit="%"
        delta={{ text: '+4% vs last month', direction: 'up', sentiment: 'positive' }}
      />,
    );
    expect(screen.getByText('62')).toBeDefined();
    expect(screen.getByText('+4% vs last month')).toBeDefined();
  });

  it('drills down via a stretched button named by the label', () => {
    const onActivate = vi.fn();
    render(<StatTile label="High-risk employees" value={9} onActivate={onActivate} />);
    fireEvent.click(screen.getByRole('button', { name: 'High-risk employees' }));
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('renders loading and empty states', () => {
    const { rerender } = render(<StatTile label="X" value={1} state="loading" />);
    expect(screen.getByText('Loading')).toBeDefined();
    rerender(<StatTile label="X" value={1} state="empty" />);
    expect(screen.getByText('No data yet')).toBeDefined();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <StatTile label="Completion" value={62} onActivate={() => undefined} />,
    );
    await expectNoA11yViolations(container);
  });
});
