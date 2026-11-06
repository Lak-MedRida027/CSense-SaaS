import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Settings } from '../../icons';
import { expectNoA11yViolations } from '../../test/axe';
import { IconButton } from './IconButton';

describe('IconButton', () => {
  it('exposes the required label as its accessible name', () => {
    render(<IconButton icon={Settings} label="Settings" />);
    expect(screen.getByRole('button', { name: 'Settings' })).toBeDefined();
  });

  it('does not fire while loading', () => {
    const onClick = vi.fn();
    render(<IconButton icon={Settings} label="Settings" loading onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <IconButton icon={Settings} label="Settings" aria-pressed={false} />,
    );
    await expectNoA11yViolations(container);
  });
});
