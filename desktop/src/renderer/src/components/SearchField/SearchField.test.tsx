import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { SearchField } from './SearchField';

describe('SearchField', () => {
  it('is a search landmark with a labelled input, clear button and live count', () => {
    const onChange = vi.fn();
    render(
      <SearchField
        label="Search employees"
        value="ami"
        onChange={onChange}
        resultCountText="3 employees found"
      />,
    );
    expect(screen.getByRole('search')).toBeDefined();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search employees' }), {
      target: { value: 'amin' },
    });
    expect(onChange).toHaveBeenCalledWith('amin');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onChange).toHaveBeenCalledWith('');
    expect(screen.getByRole('status').textContent).toBe('3 employees found');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <SearchField label="Search" value="" onChange={() => undefined} />,
    );
    await expectNoA11yViolations(container);
  });
});
