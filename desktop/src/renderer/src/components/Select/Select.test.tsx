import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { Select } from './Select';

describe('Select', () => {
  it('renders a labelled native select with a placeholder option', () => {
    render(
      <Select label="Department" placeholder="All" options={[{ value: 'ops', label: 'Ops' }]} />,
    );
    const select = screen.getByRole('combobox', { name: 'Department' });
    expect(select.querySelectorAll('option')).toHaveLength(2);
  });

  it('is disabled and explains itself when empty', () => {
    render(<Select label="Team" options={[]} />);
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Team' });
    expect(select.disabled).toBe(true);
    expect(screen.getByText('No options available')).toBeDefined();
  });

  it('marks loading with aria-busy', () => {
    render(<Select label="Team" options={[{ value: 'a', label: 'A' }]} loading />);
    expect(screen.getByRole('combobox', { name: 'Team' }).getAttribute('aria-busy')).toBe('true');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <Select label="Department" options={[{ value: 'a', label: 'A' }]} error="Choose one" />,
    );
    await expectNoA11yViolations(container);
  });
});
