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

describe('LockdownBanner focus-loss warning', () => {
  it('announces the warning politely while active, and never while exiting', () => {
    const warning = 'You left secure mode. Leaving 2 more times ends this attempt.';
    const { rerender } = render(
      <LockdownBanner state="active" onRequestExit={() => undefined} warning={warning} />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(warning);
    expect(alert.getAttribute('aria-live')).toBe('polite');
    rerender(<LockdownBanner state="exiting" onRequestExit={() => undefined} warning={warning} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('has no axe violations with a warning', async () => {
    const { container } = render(
      <LockdownBanner state="active" onRequestExit={() => undefined} warning="Careful." />,
    );
    await expectNoA11yViolations(container);
  });
});
