import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { Card } from './Card';

describe('Card', () => {
  it('labels its region by the title', () => {
    render(<Card title="Your level">Body</Card>);
    expect(screen.getByRole('region', { name: 'Your level' })).toBeDefined();
  });

  it('renders loading, empty and error states', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<Card title="X" state="loading" />);
    expect(screen.getByRole('region', { name: 'X' }).getAttribute('aria-busy')).toBe('true');
    rerender(<Card title="X" state="empty" emptyTitle="Nothing yet" />);
    expect(screen.getByText('Nothing yet')).toBeDefined();
    rerender(<Card title="X" state="error" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <Card title="Card" actions={<button type="button">Act</button>}>
        Content
      </Card>,
    );
    await expectNoA11yViolations(container);
  });
});
