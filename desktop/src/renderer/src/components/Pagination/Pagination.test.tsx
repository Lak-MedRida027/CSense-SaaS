import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { Pagination } from './Pagination';

describe('Pagination', () => {
  it('marks the current page and collapses long ranges', () => {
    render(<Pagination page={5} pageCount={20} onPageChange={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Page 5' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('button', { name: 'Page 1' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Page 20' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Page 10' })).toBeNull();
  });

  it('navigates and disables at the edges', () => {
    const onPageChange = vi.fn();
    render(<Pagination page={1} pageCount={3} onPageChange={onPageChange} />);
    expect(screen.getByRole('button', { name: 'Previous page' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('renders nothing for a single page', () => {
    const { container } = render(
      <Pagination page={1} pageCount={1} onPageChange={() => undefined} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <Pagination page={2} pageCount={5} onPageChange={() => undefined} />,
    );
    await expectNoA11yViolations(container);
  });
});
