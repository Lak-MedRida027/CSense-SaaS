import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { LockdownBanner } from './LockdownBanner';

describe('LockdownBanner', () => {
  it('active: explains restrictions and offers a keyboard-reachable exit', () => {
    const onRequestExit = vi.fn();
    render(<LockdownBanner state="active" onRequestExit={onRequestExit} />);
    expect(screen.getByRole('region', { name: 'Secure quiz mode' })).toBeDefined();
    expect(screen.getByText(/Shortcuts, clipboard and other apps are restricted/)).toBeDefined();
    const exit = screen.getByRole('button', { name: 'Exit quiz' });
    exit.focus();
    expect(document.activeElement).toBe(exit);
    fireEvent.click(exit);
    expect(onRequestExit).toHaveBeenCalledOnce();
  });

  it('no exit button while entering; failed explains the problem', () => {
    const { rerender } = render(
      <LockdownBanner state="entering" onRequestExit={() => undefined} />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<LockdownBanner state="failed" onRequestExit={() => undefined} />);
    expect(screen.getByText('Secure mode could not start')).toBeDefined();
  });

  it('has no axe violations', async () => {
    const { container } = render(<LockdownBanner state="active" onRequestExit={() => undefined} />);
    await expectNoA11yViolations(container);
  });
});
