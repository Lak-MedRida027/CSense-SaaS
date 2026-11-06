import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { BarChart } from './BarChart';

const data = [
  { id: 'm1', label: '1 Welcome', value: 96 },
  { id: 'm2', label: '2 Passwords', value: 81 },
];

describe('BarChart', () => {
  it('prints every value and can switch to a table', () => {
    render(<BarChart title="Completion by module" data={data} valueHeader="Completed" />);
    expect(screen.getByText('96%')).toBeDefined();
    const toggle = screen.getByRole('button', { name: 'View as table' });
    fireEvent.click(toggle);
    expect(screen.getByRole('table', { name: 'Completion by module' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'View as chart' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('shows an empty state', () => {
    render(<BarChart title="X" data={[]} />);
    expect(screen.getByText('No data yet')).toBeDefined();
  });

  it('has no axe violations', async () => {
    const { container } = render(<BarChart title="Completion" data={data} />);
    await expectNoA11yViolations(container);
  });
});
