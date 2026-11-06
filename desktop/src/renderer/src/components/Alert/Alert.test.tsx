import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { Alert } from './Alert';

describe('Alert', () => {
  it('critical alerts are assertive, others are status', () => {
    const { rerender } = render(<Alert tone="critical" title="Access restricted" />);
    expect(screen.getByRole('alert').textContent).toContain('Access restricted');
    rerender(<Alert tone="info" title="Heads up" />);
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('static callouts are not announced', () => {
    render(<Alert tone="caution" title="Note" announce={false} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('can be dismissed', () => {
    const onDismiss = vi.fn();
    render(<Alert tone="success" title="Saved" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('has no axe violations in every tone', async () => {
    const { container } = render(
      <div>
        <Alert tone="info" title="Info" announce={false} />
        <Alert tone="success" title="Success" announce={false} />
        <Alert tone="caution" title="Caution" announce={false} />
        <Alert tone="critical" title="Critical" announce={false} />
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
