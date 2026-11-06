import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorState } from './ErrorState';

describe('ErrorState', () => {
  it('offers retry only when a handler is provided', () => {
    const { rerender } = render(<ErrorState description="Offline" />);
    expect(screen.queryByRole('button')).toBeNull();
    const onRetry = vi.fn();
    rerender(<ErrorState description="Offline" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
