import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Spinner } from './Spinner';

describe('Spinner', () => {
  it('announces a status with a text label', () => {
    render(<Spinner label="Loading modules" />);
    expect(screen.getByRole('status').textContent).toBe('Loading modules');
  });

  it('decorative spinners are silent', () => {
    render(<Spinner decorative />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
