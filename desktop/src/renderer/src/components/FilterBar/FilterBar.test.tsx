import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilterBar } from './FilterBar';

describe('FilterBar', () => {
  it('groups filters and shows Clear only when filters are active', () => {
    const onClear = vi.fn();
    const { rerender } = render(
      <FilterBar label="Filter employees" onClear={onClear} activeCount={0}>
        <span>filters</span>
      </FilterBar>,
    );
    expect(screen.getByRole('group', { name: 'Filter employees' })).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
    rerender(
      <FilterBar label="Filter employees" onClear={onClear} activeCount={2}>
        <span>filters</span>
      </FilterBar>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters (2)' }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
